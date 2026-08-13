import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { request, type IncomingMessage, type ClientRequest } from "node:http";
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

  it("isolates duplicate subscriptions and makes unsubscribe idempotent", () => {
    const bus = new BusClass();
    const received: ConfigEvent[] = [];
    const listener = (event: ConfigEvent) => received.push(event);
    const unsubscribeA = bus.subscribe("user-1", listener);
    const unsubscribeB = bus.subscribe("user-1", listener);

    unsubscribeA();
    unsubscribeA();
    bus.emit("user-1", { type: "host.upserted", revision: 1, timestamp: "", data: {} });

    expect(received).toHaveLength(1);
    expect(bus.listenerCount("user-1")).toBe(1);
    unsubscribeB();
    expect(bus.listenerCount("user-1")).toBe(0);
  });

  it("assigns per-user event cursors and suppresses observed events", () => {
    const bus = new BusClass();
    const first: number[] = [];
    const second: number[] = [];
    bus.subscribe("user-1", (_event, eventId) => first.push(eventId));

    bus.emit("user-1", { type: "host.upserted", revision: 5, timestamp: "", data: {} });
    bus.emit("user-1", { type: "host.deleted", revision: 6, timestamp: "", data: {} });

    bus.subscribe("user-1", (_event, eventId) => second.push(eventId), { afterEventId: 1 });
    bus.emit("user-1", { type: "device.revoked", revision: 0, timestamp: "", data: {} });

    expect(first).toEqual([1, 2, 3]);
    expect(second).toEqual([3]);
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

function openSse(
  baseUrl: string,
  cookie: { name: string; value: string },
  lastEventId?: number,
): { request: ClientRequest; response: Promise<IncomingMessage> } {
  let resolveResponse!: (response: IncomingMessage) => void;
  let rejectResponse!: (error: Error) => void;
  const response = new Promise<IncomingMessage>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const req = request(`${baseUrl}/api/v1/events`, {
    headers: {
      Cookie: `${cookie.name}=${cookie.value}`,
      ...(lastEventId === undefined ? {} : { "Last-Event-ID": String(lastEventId) }),
    },
  });
  req.once("response", resolveResponse);
  req.once("error", rejectResponse);
  req.end();
  return { request: req, response };
}

function waitForChunk(response: IncomingMessage, marker: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    const onData = (chunk: Buffer | string) => {
      body += chunk.toString();
      if (!body.includes(marker)) return;
      cleanup();
      resolve(body);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`SSE response closed before receiving ${JSON.stringify(marker)}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      response.off("data", onData);
      response.off("close", onClose);
      response.off("error", onError);
    };
    response.on("data", onData);
    response.once("close", onClose);
    response.once("error", onError);
  });
}

function waitForClose(response: IncomingMessage): Promise<void> {
  if (response.destroyed) return Promise.resolve();
  return new Promise((resolve) => response.once("close", resolve));
}

async function waitForListenerCount(
  bus: ConfigEventBus,
  userId: string,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (bus.listenerCount(userId) === expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${expected} listeners; got ${bus.listenerCount(userId)}`);
}

describe("Config event SSE lifecycle", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;
  let eventBus: ConfigEventBus;
  let cookie: { name: string; value: string };
  let userId: string;
  let baseUrl: string;

  beforeAll(async () => {
    const cfg = makeTestConfig();
    cleanup = cfg.cleanup;
    app = buildApp(cfg.config);
    await app.ready();

    const register = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "sse-lifecycle@example.com",
        password: "test-password-123",
        device: { installationId: "sse-lifecycle-device", name: "SSE Device", platform: "web" },
      },
    });
    expect(register.statusCode).toBe(200);
    cookie = register.cookies[0];
    userId = register.json().user.id;
    eventBus = (app as unknown as { eventBus: ConfigEventBus }).eventBus;

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("SSE test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("cleans up the listener and heartbeat when the client closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const connection = openSse(baseUrl, cookie);
      const response = await connection.response;
      expect(response.statusCode).toBe(200);
      await waitForChunk(response, ": connected\n\n");
      expect(eventBus.listenerCount(userId)).toBe(1);
      expect(vi.getTimerCount()).toBe(1);

      eventBus.emit(userId, {
        type: "host.upserted",
        revision: 7,
        timestamp: "2026-01-01T00:00:00Z",
        data: { hostId: "hst_sse" },
      });
      const eventBody = await waitForChunk(response, "id: 1\n");
      expect(eventBody).toContain('data: {"type":"host.upserted","revision":7');

      connection.request.destroy();
      await waitForClose(response);
      await waitForListenerCount(eventBus, userId, 0);
      expect(vi.getTimerCount()).toBe(0);

      // A late event must not write to the closed response or throw from emit.
      expect(() =>
        eventBus.emit(userId, {
          type: "host.deleted",
          revision: 8,
          timestamp: "2026-01-01T00:00:01Z",
          data: { hostId: "hst_sse" },
        }),
      ).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses Last-Event-ID as a non-replaying in-memory cursor", async () => {
    const firstConnection = openSse(baseUrl, cookie);
    const firstResponse = await firstConnection.response;
    await waitForChunk(firstResponse, ": connected\n\n");
    eventBus.emit(userId, { type: "host.upserted", revision: 9, timestamp: "", data: {} });
    await waitForChunk(firstResponse, "id: 3\n");
    firstConnection.request.destroy();
    await waitForClose(firstResponse);

    const reconnect = openSse(baseUrl, cookie, 3);
    const reconnectResponse = await reconnect.response;
    await waitForChunk(reconnectResponse, ": connected\n\n");
    eventBus.emit(userId, { type: "host.deleted", revision: 10, timestamp: "", data: {} });
    const body = await waitForChunk(reconnectResponse, "id: 4\n");

    expect(body).not.toContain('"revision":9');
    expect(body).toContain('"revision":10');
    reconnect.request.destroy();
    await waitForClose(reconnectResponse);
  });
});
