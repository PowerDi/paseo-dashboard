import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), "paseo-host-isolation-test-"));
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

function makeConnection() {
  return {
    type: "relay" as const,
    serverId: "shared-server-id",
    relayEndpoint: "relay.paseo.sh:443",
    useTls: true,
    daemonPublicKeyB64: randomBytes(32).toString("base64"),
  };
}

describe("Host import tenant isolation", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;
  let cookieA: { name: string; value: string };
  let cookieB: { name: string; value: string };

  beforeAll(async () => {
    const testConfig = makeTestConfig();
    cleanup = testConfig.cleanup;
    app = buildApp(testConfig.config);
    await app.ready();

    const registerA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "alice@host-isolation.test",
        password: "password-alice-123",
        device: { installationId: "alice-device", name: "Alice Device", platform: "web" },
      },
    });
    const registerB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "bob@host-isolation.test",
        password: "password-bob-123",
        device: { installationId: "bob-device", name: "Bob Device", platform: "web" },
      },
    });

    expect(registerA.statusCode).toBe(200);
    expect(registerB.statusCode).toBe(200);
    cookieA = registerA.cookies[0];
    cookieB = registerB.cookies[0];
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("scopes idempotency keys and capability fingerprints to one user", async () => {
    const connection = makeConnection();
    const importPayload = {
      connection,
      clientVerification: { verifiedAt: new Date().toISOString(), serverVersion: "0.3.0" },
      idempotencyKey: "shared-idempotency-key",
    };

    const importA = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [cookieA.name]: cookieA.value },
      payload: { ...importPayload, label: "Alice Host" },
    });
    const importB = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [cookieB.name]: cookieB.value },
      payload: { ...importPayload, label: "Bob Host" },
    });

    expect(importA.statusCode).toBe(200);
    expect(importB.statusCode).toBe(200);
    expect(importB.json().host.id).not.toBe(importA.json().host.id);
    expect(importB.json().host.label).toBe("Bob Host");

    const duplicateForB = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [cookieB.name]: cookieB.value },
      payload: {
        ...importPayload,
        label: "Bob Duplicate",
        idempotencyKey: "bob-second-idempotency-key",
      },
    });
    expect(duplicateForB.statusCode).toBe(409);

    const hostsA = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const hostsB = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [cookieB.name]: cookieB.value },
    });

    expect(hostsA.json().map((host: { id: string }) => host.id)).toEqual([importA.json().host.id]);
    expect(hostsB.json().map((host: { id: string }) => host.id)).toEqual([importB.json().host.id]);
  });
});
