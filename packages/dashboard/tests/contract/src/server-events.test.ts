import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import type { ConfigEvent, ConfigEventBus } from "@getpaseo/dashboard-server/lib/event-bus";
import { ConfigEventBus as BusClass } from "@getpaseo/dashboard-server/lib/event-bus";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "paseo-sse-test-"));
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

// ── Unit tests for ConfigEventBus ───────────────────

describe("ConfigEventBus (unit)", () => {
  it("subscribe + emit delivers events", () => {
    const bus = new BusClass();
    const received: ConfigEvent[] = [];
    bus.subscribe("user-1", (e) => received.push(e));

    bus.emit("user-1", {
      type: "host.upserted",
      revision: 5,
      timestamp: "2026-01-01T00:00:00Z",
      data: { hostId: "hst_1" },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("host.upserted");
  });

  it("unsubscribe stops delivery", () => {
    const bus = new BusClass();
    const received: ConfigEvent[] = [];
    const unsub = bus.subscribe("user-1", (e) => received.push(e));

    bus.emit("user-1", { type: "host.deleted", revision: 1, timestamp: "", data: {} });
    unsub();
    bus.emit("user-1", { type: "host.upserted", revision: 2, timestamp: "", data: {} });

    expect(received).toHaveLength(1);
  });

  it("events are scoped to user", () => {
    const bus = new BusClass();
    const a: ConfigEvent[] = [];
    const b: ConfigEvent[] = [];
    bus.subscribe("user-a", (e) => a.push(e));
    bus.subscribe("user-b", (e) => b.push(e));

    bus.emit("user-a", { type: "host.upserted", revision: 1, timestamp: "", data: {} });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it("listener errors don't break other listeners", () => {
    const bus = new BusClass();
    const ok: ConfigEvent[] = [];
    bus.subscribe("user-1", () => {
      throw new Error("boom");
    });
    bus.subscribe("user-1", (e) => ok.push(e));

    bus.emit("user-1", { type: "host.upserted", revision: 1, timestamp: "", data: {} });

    expect(ok).toHaveLength(1);
  });

  it("listenerCount tracks active subscriptions", () => {
    const bus = new BusClass();
    expect(bus.listenerCount("user-1")).toBe(0);
    const unsub = bus.subscribe("user-1", () => {});
    expect(bus.listenerCount("user-1")).toBe(1);
    unsub();
    expect(bus.listenerCount("user-1")).toBe(0);
  });
});

// ── Integration tests: mutations emit events ────────

describe("Config event integration (P2.3)", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;
  let cookieA: { name: string; value: string };
  let eventBus: ConfigEventBus;
  let userId: string;
  const email = "sse-test@example.com";
  const password = "test-password-123";

  beforeAll(async () => {
    const cfg = makeTestConfig();
    cleanup = cfg.cleanup;
    app = buildApp(cfg.config);
    await app.ready();
    eventBus = (app as unknown as { eventBus: ConfigEventBus }).eventBus;

    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email,
        password,
        device: { installationId: "sse-dev-A", name: "Device A", platform: "web" },
      },
    });
    expect(regRes.statusCode).toBe(200);
    cookieA = regRes.cookies[0];
    userId = regRes.json().user.id;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("host import emits host.upserted event", async () => {
    const events: ConfigEvent[] = [];
    const unsub = eventBus.subscribe(userId, (e) => events.push(e));

    await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [cookieA.name]: cookieA.value },
      payload: {
        label: "SSE Test Host",
        connection: makeConnection("srv-sse-1"),
        clientVerification: { verifiedAt: new Date().toISOString(), serverVersion: "0.3.0" },
        idempotencyKey: "idem-sse-1",
      },
    });

    unsub();
    expect(events.length).toBeGreaterThanOrEqual(1);
    const upsert = events.find((e) => e.type === "host.upserted");
    expect(upsert).toBeDefined();
    expect(upsert?.revision).toBeGreaterThan(0);
  });

  it("host update emits host.upserted event", async () => {
    // Import a host first
    const importRes = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [cookieA.name]: cookieA.value },
      payload: {
        label: "Update Test",
        connection: makeConnection("srv-sse-2"),
        clientVerification: { verifiedAt: new Date().toISOString(), serverVersion: "0.3.0" },
        idempotencyKey: "idem-sse-2",
      },
    });
    const hostId = importRes.json().host.id;

    // Get userId and subscribe
    const events: ConfigEvent[] = [];
    const unsub = eventBus.subscribe(userId, (e) => events.push(e));

    await app.inject({
      method: "PATCH",
      url: `/api/v1/hosts/${hostId}`,
      cookies: { [cookieA.name]: cookieA.value },
      payload: { label: "Updated Label", baseVersion: 1 },
    });

    unsub();
    const upsert = events.find((e) => e.type === "host.upserted");
    expect(upsert).toBeDefined();
  });

  it("host delete emits host.deleted event", async () => {
    const importRes = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [cookieA.name]: cookieA.value },
      payload: {
        label: "Delete Test",
        connection: makeConnection("srv-sse-3"),
        clientVerification: { verifiedAt: new Date().toISOString(), serverVersion: "0.3.0" },
        idempotencyKey: "idem-sse-3",
      },
    });
    const hostId = importRes.json().host.id;

    const events: ConfigEvent[] = [];
    const unsub = eventBus.subscribe(userId, (e) => events.push(e));

    await app.inject({
      method: "DELETE",
      url: `/api/v1/hosts/${hostId}`,
      cookies: { [cookieA.name]: cookieA.value },
    });

    unsub();
    const del = events.find((e) => e.type === "host.deleted");
    expect(del).toBeDefined();
  });

  it("device revoke emits device.revoked event", async () => {
    // Login a second device for device B
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email,
        password,
        device: { installationId: "sse-dev-B", name: "Device B", platform: "web" },
      },
    });

    // Get device list to find device B's id
    const devList = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      cookies: { [cookieA.name]: cookieA.value },
    });
    const devB = (devList.json() as Array<{ id: string; isCurrentDevice: boolean }>).find(
      (d) => !d.isCurrentDevice,
    );

    const events: ConfigEvent[] = [];
    const unsub = eventBus.subscribe(userId, (e) => events.push(e));

    await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${devB!.id}`,
      cookies: { [cookieA.name]: cookieA.value },
    });

    unsub();
    const revoked = events.find((e) => e.type === "device.revoked");
    expect(revoked).toBeDefined();
  });

  // SSE endpoint (/api/v1/events) cannot be tested with Fastify inject
  // because it opens a streaming response that never completes. The event
  // bus integration tests above prove the core functionality; the SSE route
  // is a thin wrapper (writeHead + subscribe + on close).

  it("events only carry config event types — no agent data", async () => {
    const events: ConfigEvent[] = [];
    const unsub = eventBus.subscribe(userId, (e) => events.push(e));

    // Trigger all mutation types
    const importRes = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [cookieA.name]: cookieA.value },
      payload: {
        label: "Event Type Test",
        connection: makeConnection("srv-sse-types"),
        clientVerification: { verifiedAt: new Date().toISOString(), serverVersion: "0.3.0" },
        idempotencyKey: "idem-sse-types",
      },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/hosts/${importRes.json().host.id}`,
      cookies: { [cookieA.name]: cookieA.value },
      payload: { label: "Renamed", baseVersion: 1 },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/v1/hosts/${importRes.json().host.id}`,
      cookies: { [cookieA.name]: cookieA.value },
    });

    unsub();

    // Every event must be one of the four config types
    const allowedTypes = new Set([
      "host.upserted",
      "host.deleted",
      "device.revoked",
      "session.revoked",
    ]);
    for (const e of events) {
      expect(allowedTypes.has(e.type)).toBe(true);
      // No agent data fields present
      expect(e.data).not.toHaveProperty("agents");
      expect(e.data).not.toHaveProperty("timeline");
      expect(e.data).not.toHaveProperty("terminal");
      expect(e.data).not.toHaveProperty("message");
    }
  });
});
