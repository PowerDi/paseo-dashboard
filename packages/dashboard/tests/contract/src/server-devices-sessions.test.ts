import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import type { Device, Session } from "@getpaseo/dashboard-shared";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "paseo-dev-test-"));
  const kekPath = join(dir, ".kek");
  writeFileSync(kekPath, randomBytes(32), { mode: 0o600 });
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    dataDir: dir,
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
  };
  return { config, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeConnection(serverId: string) {
  return {
    type: "relay" as const,
    serverId,
    relayEndpoint: "relay.paseo.sh:443",
    useTls: true,
    daemonPublicKeyB64: randomBytes(16).toString("base64"),
  };
}

async function importHost(
  app: ReturnType<typeof buildApp>,
  cookie: { name: string; value: string },
  serverId: string,
  label: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/hosts/import",
    cookies: { [cookie.name]: cookie.value },
    payload: {
      label,
      connection: makeConnection(serverId),
      clientVerification: { verifiedAt: new Date().toISOString(), serverVersion: "0.3.0" },
      idempotencyKey: `idem-${serverId}-${label}`,
    },
  });
  return res.json() as { syncRevision: number };
}

async function loginSecondDevice(
  app: ReturnType<typeof buildApp>,
  email: string,
  password: string,
  installationId: string,
): Promise<{ name: string; value: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/132.0 internal-detail",
    },
    remoteAddress: "198.51.100.77",
    payload: {
      email,
      password,
      device: { installationId, name: `Device-${installationId}`, platform: "web" },
    },
  });
  expect(res.statusCode).toBe(200);
  return res.cookies[0];
}

describe("Device & Session management (P2.2)", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;
  let cookieA: { name: string; value: string };
  let cookieB: { name: string; value: string };
  const email = "device-test@example.com";
  const password = "test-password-123";

  beforeAll(async () => {
    const cfg = makeTestConfig();
    cleanup = cfg.cleanup;
    app = buildApp(cfg.config);
    await app.ready();

    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36 secret-detail",
      },
      remoteAddress: "203.0.113.42",
      payload: {
        email,
        password,
        device: { installationId: "dev-A", name: "Device A", platform: "web" },
      },
    });
    expect(regRes.statusCode).toBe(200);
    cookieA = regRes.cookies[0];

    // Login with a second device
    cookieB = await loginSecondDevice(app, email, password, "dev-B");
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  // ── GET /devices ──────────────────────────────────

  it("GET /devices returns all devices with current device marked", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(res.statusCode).toBe(200);
    const devices = res.json() as Device[];
    expect(devices.length).toBe(2);

    const current = devices.find((d) => d.isCurrentDevice);
    expect(current).toBeDefined();
    expect(current?.platform).toBe("web");
    expect(current?.lastSyncedRevision).toBe(0);
    expect(current?.lastIpPrefix).toBe("203.0.113.0");
    expect(current?.lastUserAgentSummary).toBe("Chrome 131 · Windows");
    expect(current?.lastAuthMethod).toBe("password");
    expect(current?.revokedAt).toBeNull();

    const second = devices.find((device) => !device.isCurrentDevice);
    expect(second?.lastIpPrefix).toBe("198.51.100.0");
    expect(second?.lastUserAgentSummary).toBe("Firefox 132 · Linux");
    expect(second?.lastAuthMethod).toBe("password");
  });

  it("GET /devices from device B marks B as current", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(200);
    const devices = res.json() as Device[];
    const current = devices.find((d) => d.isCurrentDevice);
    expect(current?.displayName).toContain("dev-B");
  });

  // ── sync tracks lastSyncedRevision ─────────────────

  it("sync updates device.lastSyncedRevision", async () => {
    // Import a host to bump revision
    await importHost(app, cookieA, "srv-dev-sync", "Sync Test Host");

    // Sync from device A
    const syncRes = await app.inject({
      method: "GET",
      url: "/api/v1/host-sync?after=0",
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(syncRes.statusCode).toBe(200);
    const syncBody = syncRes.json();
    expect(syncBody.toRevision).toBeGreaterThan(0);

    // Check device A's lastSyncedRevision was updated
    const devRes = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const devices = devRes.json() as Device[];
    const devA = devices.find((d) => d.isCurrentDevice);
    expect(devA?.lastSyncedRevision).toBe(syncBody.toRevision);

    // Device B should still have lastSyncedRevision = 0
    const devB = devices.find((d) => !d.isCurrentDevice);
    expect(devB?.lastSyncedRevision).toBe(0);
  });

  // ── DELETE /devices/:id ───────────────────────────

  it("DELETE /devices/:id revokes device and its sessions", async () => {
    // Get device B's id
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const devices = listRes.json() as Device[];
    const devB = devices.find((d) => !d.isCurrentDevice);
    expect(devB).toBeDefined();

    // Revoke device B
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${devB!.id}`,
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(delRes.statusCode).toBe(200);

    // Device B's session should now be invalid
    const syncRes = await app.inject({
      method: "GET",
      url: "/api/v1/host-sync?after=0",
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(syncRes.statusCode).toBe(401);
  });

  it("DELETE /devices/:id rejects revoking current device", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const devices = listRes.json() as Device[];
    const current = devices.find((d) => d.isCurrentDevice);

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${current!.id}`,
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(delRes.statusCode).toBe(400);
  });

  it("DELETE /devices/:id is idempotent", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const devices = listRes.json() as Device[];
    const revoked = devices.find((d) => d.revokedAt !== null);
    expect(revoked).toBeDefined();

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${revoked!.id}`,
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(delRes.statusCode).toBe(200);
  });

  // ── GET /sessions ─────────────────────────────────

  it("GET /sessions returns active sessions with current marked", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(res.statusCode).toBe(200);
    const sessions = res.json() as (Session & { isCurrentSession: boolean })[];
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const current = sessions.find((session) => session.isCurrentSession);
    expect(current).toBeDefined();
    expect(current?.ipPrefix).toBe("203.0.113.0");
    expect(current?.userAgentSummary).toBe("Chrome 131 · Windows");
    expect(current?.authMethod).toBe("password");
  });

  it("GET /sessions excludes revoked sessions", async () => {
    // Device B's sessions were revoked in the earlier test
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const sessions = res.json();
    // All returned sessions should be active
    for (const s of sessions) {
      expect(s.revokedAt).toBeNull();
    }
  });

  // ── DELETE /sessions/:id ──────────────────────────

  it("DELETE /sessions/:id revokes a specific session", async () => {
    // Login a third device to get an extra session
    const cookieC = await loginSecondDevice(app, email, password, "dev-C");

    // Get sessions
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const sessions = listRes.json();
    const targetSession = sessions.find((s: { isCurrentSession: boolean }) => !s.isCurrentSession);
    expect(targetSession).toBeDefined();

    // Revoke that session
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/sessions/${targetSession!.id}`,
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(delRes.statusCode).toBe(200);

    // The revoked session's cookie should no longer work
    const syncRes = await app.inject({
      method: "GET",
      url: "/api/v1/host-sync?after=0",
      cookies: { [cookieC.name]: cookieC.value },
    });
    expect(syncRes.statusCode).toBe(401);
  });
});
