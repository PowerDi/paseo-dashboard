import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "paseo-sec-test-"));
  const kekPath = join(dir, ".kek");
  writeFileSync(kekPath, randomBytes(32), { mode: 0o600 });
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    dataDir: dir,
    logLevel: "silent",
    corsOrigin: "http://localhost:5173",
    kekFile: kekPath,
    accessTokenTtl: 900,
    refreshTokenTtl: 7 * 24 * 3600,
    refreshTokenBytes: 32,
    argon2MemoryCost: 1024,
    argon2TimeCost: 1,
    argon2Parallelism: 1,
    registrationOpen: true,
    trustedProxies: [],
    rateLimitEnabled: true,
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

describe("Security hardening (P2.4)", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;
  let cookieA: { name: string; value: string };
  let cookieB: { name: string; value: string };
  let hostIdA: string;
  let sessionIdA: string;

  beforeAll(async () => {
    const cfg = makeTestConfig();
    cleanup = cfg.cleanup;
    app = buildApp(cfg.config);
    await app.ready();

    // Register user A
    const regA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "userA@security.test",
        password: "password-A-123",
        device: { installationId: "sec-dev-A", name: "Dev A", platform: "web" },
      },
    });
    expect(regA.statusCode).toBe(200);
    cookieA = regA.cookies[0];

    // Register user B
    const regB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "userB@security.test",
        password: "password-B-123",
        device: { installationId: "sec-dev-B", name: "Dev B", platform: "web" },
      },
    });
    expect(regB.statusCode).toBe(200);
    cookieB = regB.cookies[0];

    // User A imports a host
    const importRes = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [cookieA.name]: cookieA.value },
      payload: {
        label: "User A Host",
        connection: makeConnection("srv-sec-A"),
        clientVerification: { verifiedAt: new Date().toISOString(), serverVersion: "0.3.0" },
        idempotencyKey: "idem-sec-A",
      },
    });
    expect(importRes.statusCode).toBe(200);
    hostIdA = importRes.json().host.id;

    const sessionsA = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(sessionsA.statusCode).toBe(200);
    sessionIdA = sessionsA.json()[0].id;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  // ── Cross-user access control ──────────────────────

  it("user B cannot list user A's hosts", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(200);
    const hosts = res.json();
    expect(hosts).toHaveLength(0);
  });

  it("user B cannot sync user A's host changes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/host-sync?after=0",
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().changes).toHaveLength(0);
  });

  it("user B cannot update user A's host", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/hosts/${hostIdA}`,
      cookies: { [cookieB.name]: cookieB.value },
      payload: { label: "Hacked", baseVersion: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("user B cannot delete user A's host", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/hosts/${hostIdA}`,
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(404);
  });

  it("user B cannot see user A's devices", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(200);
    const devices = res.json();
    // User B should only see their own device, not user A's
    expect(devices.every((d: { id: string }) => d.id !== undefined)).toBe(true);
    expect(devices).toHaveLength(1);
  });

  it("user B cannot see user A's audit events", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit-events",
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(200);
    const events = res.json().events;
    // User B should only see their own events (registration)
    expect(events.every((e: { type: string }) => !e.type.includes("host"))).toBe(true);
  });

  it("user B cannot revoke user A's device", async () => {
    // Get user A's device list
    const devListA = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const devA = devListA.json()[0];

    // User B tries to revoke user A's device
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${devA.id}`,
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(404);
  });

  it("user B cannot see user A's sessions", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions",
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((session: { id: string }) => session.id === sessionIdA)).toBe(false);
  });

  it("user B cannot revoke user A's session", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/sessions/${sessionIdA}`,
      cookies: { [cookieB.name]: cookieB.value },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Rate limiting ──────────────────────────────────

  it("login rate limit returns 429 after 10 attempts", async () => {
    // Make 10 failed login attempts (limit is 10 per minute)
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "wrong@security.test",
          password: "wrong",
          device: { installationId: `rate-${i}`, name: "Rate", platform: "web" },
        },
      });
    }

    // 11th attempt should be rate limited
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "wrong@security.test",
        password: "wrong",
        device: { installationId: "rate-11", name: "Rate", platform: "web" },
      },
    });
    expect(res.statusCode).toBe(429);
  });

  // ── Origin validation ──────────────────────────────

  it("POST with wrong Origin header returns 403", async () => {
    // Use a non-rate-limited state-changing endpoint
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/hosts/nonexistent",
      headers: { origin: "https://evil.example.com" },
      cookies: { [cookieA.name]: cookieA.value },
      payload: { label: "Evil", baseVersion: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── CSP and security headers ───────────────────────

  it("responses include Content-Security-Policy header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("responses include X-Content-Type-Options header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("responses include X-Frame-Options header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  // ── Audit query API ────────────────────────────────

  it("GET /audit-events returns events with pagination", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit-events?limit=5",
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toBeDefined();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.nextCursor).toBeDefined();
    // User A has at least registration + host import events
    expect(body.events.length).toBeGreaterThanOrEqual(1);
  });

  it("audit events do not contain sensitive data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/audit-events",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const events = res.json().events;
    for (const e of events) {
      const metaStr = JSON.stringify(e.metadata);
      // No passwords, tokens, or connection data in audit metadata
      expect(metaStr).not.toContain("password");
      expect(metaStr).not.toContain("token");
      expect(metaStr).not.toContain("daemonPublicKey");
      expect(metaStr).not.toContain("relayEndpoint");
    }
  });
});
