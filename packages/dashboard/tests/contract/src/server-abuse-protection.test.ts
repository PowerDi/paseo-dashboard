import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), "paseo-abuse-protection-test-"));
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
      trustedProxies: ["127.0.0.1"],
      rateLimitEnabled: true,
    },
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

function device(installationId: string) {
  return { installationId, name: installationId, platform: "web" };
}

function fromIp(index: number) {
  return { "x-forwarded-for": `198.51.100.${index}` };
}

describe("Abuse protection", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;

  beforeEach(async () => {
    const testConfig = makeTestConfig();
    cleanup = testConfig.cleanup;
    app = buildApp(testConfig.config);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    cleanup();
  });

  async function register(email: string, installationId: string, ip: number) {
    return app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: fromIp(ip),
      payload: {
        email,
        password: "password-register-123",
        device: device(installationId),
      },
    });
  }

  it("limits registration by IP even when account and device change", async () => {
    for (let index = 1; index <= 3; index++) {
      const response = await register(`ip-${index}@abuse-protection.test`, `ip-device-${index}`, 1);
      expect(response.statusCode).toBe(200);
    }

    const limited = await register("ip-4@abuse-protection.test", "ip-device-4", 1);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("rate_limited");
    expect(limited.headers["retry-after"]).toBe("60");
  });

  it("limits registration by normalized account across IPs", async () => {
    expect((await register("same@abuse-protection.test", "account-device-1", 1)).statusCode).toBe(
      200,
    );
    expect((await register(" SAME@abuse-protection.test ", "account-device-2", 2)).statusCode).toBe(
      400,
    );
    expect((await register("same@abuse-protection.test", "account-device-3", 3)).statusCode).toBe(
      400,
    );

    const limited = await register("same@abuse-protection.test", "account-device-4", 4);
    expect(limited.statusCode).toBe(429);
    expect((await register("other@abuse-protection.test", "account-device-5", 5)).statusCode).toBe(
      200,
    );
  });

  it("limits registration by installation across accounts and IPs", async () => {
    for (let index = 1; index <= 3; index++) {
      const response = await register(
        `device-${index}@abuse-protection.test`,
        "shared-installation",
        index,
      );
      expect(response.statusCode).toBe(200);
    }

    const limited = await register("device-4@abuse-protection.test", "shared-installation", 4);
    expect(limited.statusCode).toBe(429);
    expect(
      (await register("device-5@abuse-protection.test", "new-installation", 5)).statusCode,
    ).toBe(200);
  });

  it("limits login by account across devices and IPs", async () => {
    expect(
      (await register("login-account@abuse-protection.test", "seed-device", 100)).statusCode,
    ).toBe(200);

    for (let index = 1; index <= 5; index++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: fromIp(index),
        payload: {
          email: "login-account@abuse-protection.test",
          password: "wrong-password",
          device: device(`login-account-device-${index}`),
        },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: fromIp(6),
      payload: {
        email: "login-account@abuse-protection.test",
        password: "wrong-password",
        device: device("login-account-device-6"),
      },
    });
    expect(limited.statusCode).toBe(429);

    const otherAccount = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: fromIp(7),
      payload: {
        email: "other-login@abuse-protection.test",
        password: "wrong-password",
        device: device("login-account-device-7"),
      },
    });
    expect(otherAccount.statusCode).toBe(401);
  });

  it("limits login by installation across accounts and IPs", async () => {
    for (let index = 1; index <= 5; index++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: fromIp(index),
        payload: {
          email: `login-device-${index}@abuse-protection.test`,
          password: "wrong-password",
          device: device("shared-login-installation"),
        },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: fromIp(6),
      payload: {
        email: "login-device-6@abuse-protection.test",
        password: "wrong-password",
        device: device("shared-login-installation"),
      },
    });
    expect(limited.statusCode).toBe(429);

    const otherDevice = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: fromIp(7),
      payload: {
        email: "login-device-7@abuse-protection.test",
        password: "wrong-password",
        device: device("other-login-installation"),
      },
    });
    expect(otherDevice.statusCode).toBe(401);
  });

  it("limits refresh replay by credential across IPs", async () => {
    for (let index = 1; index <= 10; index++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        headers: fromIp(index),
        payload: { refreshToken: "replayed-refresh-token" },
      });
      expect(response.statusCode).toBe(401);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: fromIp(11),
      payload: { refreshToken: "replayed-refresh-token" },
    });
    expect(limited.statusCode).toBe(429);

    const otherCredential = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: fromIp(12),
      payload: { refreshToken: "different-refresh-token" },
    });
    expect(otherCredential.statusCode).toBe(401);
  });

  it("limits Host import by authenticated account across IPs", async () => {
    const admin = await register("host-admin@abuse-protection.test", "host-admin-device", 100);
    expect(admin.statusCode).toBe(200);
    const adminCookie = admin.cookies[0];

    for (let index = 1; index <= 10; index++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/hosts/import",
        headers: fromIp(index),
        cookies: { [adminCookie.name]: adminCookie.value },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    }

    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      headers: fromIp(11),
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: {},
    });
    expect(limited.statusCode).toBe(429);

    const member = await register("host-member@abuse-protection.test", "host-member-device", 101);
    expect(member.statusCode).toBe(200);
    const memberCookie = member.cookies[0];
    const otherAccount = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      headers: fromIp(11),
      cookies: { [memberCookie.name]: memberCookie.value },
      payload: {},
    });
    expect(otherAccount.statusCode).toBe(400);
  });
});
