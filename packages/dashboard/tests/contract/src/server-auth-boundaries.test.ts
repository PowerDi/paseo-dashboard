import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), "paseo-auth-boundary-test-"));
  const kekPath = join(dataDir, ".kek");
  writeFileSync(kekPath, randomBytes(32), { mode: 0o600 });

  return {
    config: {
      host: "127.0.0.1",
      port: 0,
      dataDir,
      logLevel: "silent",
      corsOrigin: "*",
      kekFile: kekPath,
      accessTokenTtl: 900,
      refreshTokenTtl: 7 * 24 * 3600,
      refreshTokenBytes: 32,
      argon2MemoryCost: 1024,
      argon2TimeCost: 1,
      argon2Parallelism: 1,
      registrationOpen: true,
      trustedProxies: [],
      rateLimitEnabled: false,
    },
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

describe("Auth principal boundaries", () => {
  let app: ReturnType<typeof buildApp>;
  let sql: Database.Database;
  let cleanup: () => void;
  let userId: string;
  let deviceId: string;
  let accessToken: string;
  let refreshToken: string;

  beforeEach(async () => {
    const testConfig = makeTestConfig();
    cleanup = testConfig.cleanup;
    app = buildApp(testConfig.config);
    await app.ready();

    const registration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "alice@auth-boundary.test",
        password: "password-alice-123",
        device: { installationId: "alice-device", name: "Alice Device", platform: "web" },
      },
    });
    expect(registration.statusCode).toBe(200);

    const body = registration.json();
    userId = body.user.id;
    deviceId = body.deviceId;
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
    sql = new Database(join(testConfig.config.dataDir, "dashboard.db"));
  });

  afterEach(async () => {
    sql.close();
    await app.close();
    cleanup();
  });

  it("rejects an access token after the account is locked", async () => {
    sql.prepare("UPDATE users SET status = 'locked' WHERE id = ?").run(userId);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects a refresh token after the account is locked", async () => {
    sql.prepare("UPDATE users SET status = 'locked' WHERE id = ?").run(userId);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects access and refresh tokens after the session device is revoked", async () => {
    sql
      .prepare("UPDATE devices SET revoked_at = ? WHERE id = ?")
      .run(new Date().toISOString(), deviceId);

    const accessResponse = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const refreshResponse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken },
    });

    expect(accessResponse.statusCode).toBe(401);
    expect(refreshResponse.statusCode).toBe(401);
  });

  it("rejects a session whose device belongs to another user", async () => {
    const otherRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "bob@auth-boundary.test",
        password: "password-bob-123",
        device: { installationId: "bob-device", name: "Bob Device", platform: "web" },
      },
    });
    expect(otherRegistration.statusCode).toBe(200);

    const otherDeviceId = otherRegistration.json().deviceId;
    sql.prepare("UPDATE sessions SET device_id = ? WHERE user_id = ?").run(otherDeviceId, userId);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it("does not expose another user's device through a malformed session", async () => {
    const otherRegistration = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "bob@auth-boundary.test",
        password: "password-bob-123",
        device: { installationId: "bob-device", name: "Bob Device", platform: "web" },
      },
    });
    expect(otherRegistration.statusCode).toBe(200);

    const secondAliceLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@auth-boundary.test",
        password: "password-alice-123",
        device: {
          installationId: "alice-second-device",
          name: "Alice Second Device",
          platform: "web",
        },
      },
    });
    expect(secondAliceLogin.statusCode).toBe(200);

    const otherDeviceId = otherRegistration.json().deviceId;
    const accessTokenHash = createHash("sha256").update(accessToken).digest("hex");
    sql
      .prepare("UPDATE sessions SET device_id = ? WHERE access_token_hash = ?")
      .run(otherDeviceId, accessTokenHash);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      headers: { authorization: `Bearer ${secondAliceLogin.json().accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(
      response.json().some((session: { deviceId: string }) => session.deviceId === otherDeviceId),
    ).toBe(false);
  });
});
