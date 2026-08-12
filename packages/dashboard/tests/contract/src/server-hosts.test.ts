import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "paseo-board-test-"));
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

  return {
    config,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeDevice(id: string) {
  return { installationId: id, name: "Test Device", platform: "web" };
}

const testOffer = {
  type: "relay",
  serverId: "srv_01JABCDEFGHIJKLMNOPQRSTUV",
  relayEndpoint: "relay.paseo.sh:443",
  useTls: true,
  daemonPublicKeyB64: "dGVzdC1kYWVtb24tcHVibGljLWtleQ==",
};

describe("Host API contract", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;
  let authCookie: { name: string; value: string };

  beforeAll(async () => {
    const cfg = makeTestConfig();
    cleanup = cfg.cleanup;
    app = buildApp(cfg.config);
    await app.ready();

    // Register a user and grab the session cookie
    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "host-test@example.com",
        password: "test-password-123",
        device: makeDevice("host-test-dev"),
      },
    });

    authCookie = regRes.cookies[0];
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("POST /api/v1/hosts/import — creates a host with encrypted connection", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [authCookie.name]: authCookie.value },
      payload: {
        label: "Home Server",
        connection: testOffer,
        clientVerification: {
          verifiedAt: "2026-08-11T10:00:00Z",
          serverVersion: "0.3.0",
        },
        idempotencyKey: "idem-001",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.host).toBeDefined();
    expect(body.host.label).toBe("Home Server");
    expect(body.host.connection.daemonPublicKeyB64).toBe("dGVzdC1kYWVtb24tcHVibGljLWtleQ==");
    expect(body.host.version).toBe(1);
    expect(body.syncRevision).toBeGreaterThan(0);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("POST /api/v1/hosts/import — rejects missing fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [authCookie.name]: authCookie.value },
      payload: {
        label: "Broken",
        connection: { type: "relay" },
        clientVerification: {},
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("GET /api/v1/hosts — returns imported hosts", async () => {
    // Import a second host
    await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [authCookie.name]: authCookie.value },
      payload: {
        label: "Build Box",
        connection: {
          ...testOffer,
          serverId: "srv_02JABCDEFGHIJKLMNOPQRSTUV",
          daemonPublicKeyB64: "YnVpbGQtYm94LXB1YmxpYy1rZXk=",
        },
        clientVerification: {
          verifiedAt: "2026-08-11T11:00:00Z",
          serverVersion: "0.3.0",
        },
        idempotencyKey: "idem-002",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [authCookie.name]: authCookie.value },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body.some((h: { label: string; id: string }) => h.label === "Home Server")).toBe(true);
    expect(body.some((h: { label: string; id: string }) => h.label === "Build Box")).toBe(true);
    // Connection should be decrypted and returned
    expect(body[0].connection.daemonPublicKeyB64).toBeTruthy();
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("POST /api/v1/hosts/import — rejects unauthenticated requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      payload: {
        label: "Not Mine",
        connection: testOffer,
        clientVerification: { verifiedAt: "2026-08-11T10:00:00Z", serverVersion: "0.3.0" },
        idempotencyKey: "idem-003",
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("DELETE /api/v1/hosts/:id — creates tombstone", async () => {
    // Get the first host
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [authCookie.name]: authCookie.value },
    });
    const hosts = listRes.json();
    const firstHost = hosts[0];

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/hosts/${firstHost.id}`,
      cookies: { [authCookie.name]: authCookie.value },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().ok).toBe(true);

    // Host should no longer be in the list
    const listRes2 = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [authCookie.name]: authCookie.value },
    });
    const remaining = listRes2.json();
    expect(remaining.every((h: { label: string; id: string }) => h.id !== firstHost.id)).toBe(true);
  });

  // ── P1.2: Host update (PATCH) ───────────────────────

  it("PATCH /api/v1/hosts/:id — updates label with correct baseVersion", async () => {
    // Get a host
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [authCookie.name]: authCookie.value },
    });
    const hostList = listRes.json();
    const target =
      hostList.find((h: { label: string; id: string }) => h.label === "Build Box") ||
      hostList[hostList.length - 1];

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/hosts/${target.id}`,
      cookies: { [authCookie.name]: authCookie.value },
      payload: { label: "Renamed Box", baseVersion: target.version },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.host.label).toBe("Renamed Box");
    expect(body.host.version).toBe(target.version + 1);
    expect(body.syncRevision).toBeGreaterThan(0);
  });

  it("PATCH /api/v1/hosts/:id — rejects stale baseVersion with 409", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [authCookie.name]: authCookie.value },
    });
    const target = listRes.json()[0];

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/hosts/${target.id}`,
      cookies: { [authCookie.name]: authCookie.value },
      payload: { label: "Stale Update", baseVersion: 999 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("host_version_conflict");
  });

  it("PATCH /api/v1/hosts/:id — rejects missing label", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/hosts",
      cookies: { [authCookie.name]: authCookie.value },
    });
    const target = listRes.json()[0];

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/hosts/${target.id}`,
      cookies: { [authCookie.name]: authCookie.value },
      payload: { baseVersion: target.version },
    });

    expect(res.statusCode).toBe(400);
  });

  it("PATCH /api/v1/hosts/:id — rejects unauthenticated", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/hosts/some-id",
      payload: { label: "Test", baseVersion: 1 },
    });

    expect(res.statusCode).toBe(401);
  });

  // ── P1.2: Dedup via capability fingerprint ──────────

  it("POST /api/v1/hosts/import — rejects duplicate capability", async () => {
    // The testOffer was already imported in the first test
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [authCookie.name]: authCookie.value },
      payload: {
        label: "Duplicate Host",
        connection: testOffer,
        clientVerification: { verifiedAt: "2026-08-11T10:00:00Z", serverVersion: "0.3.0" },
        idempotencyKey: "idem-dup-001",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain("已导入");
  });

  // ── P1.2: Idempotency key ──────────────────────────

  it("POST /api/v1/hosts/import — same idempotencyKey returns existing host", async () => {
    const uniqueOffer = {
      ...testOffer,
      serverId: "srv_03JABCDEFGHIJKLMNOPQRSTUV",
      daemonPublicKeyB64: "dW5pcXVlLXB1YmxpYy1rZXk=",
    };

    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [authCookie.name]: authCookie.value },
      payload: {
        label: "Unique Host",
        connection: uniqueOffer,
        clientVerification: { verifiedAt: "2026-08-11T12:00:00Z", serverVersion: "0.3.0" },
        idempotencyKey: "idem-unique-001",
      },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [authCookie.name]: authCookie.value },
      payload: {
        label: "Should Be Ignored",
        connection: uniqueOffer,
        clientVerification: { verifiedAt: "2026-08-11T12:00:00Z", serverVersion: "0.3.0" },
        idempotencyKey: "idem-unique-001",
      },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().host.id).toBe(res1.json().host.id);
    expect(res2.json().host.label).toBe("Unique Host");
  });

  it("POST /api/v1/hosts/import — rejects missing idempotencyKey", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [authCookie.name]: authCookie.value },
      payload: {
        label: "No Idem",
        connection: { ...testOffer, serverId: "srv_no_idem" },
        clientVerification: { verifiedAt: "2026-08-11T10:00:00Z", serverVersion: "0.3.0" },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── P1.2: Sync returns tombstones ─────────────────

  it("GET /api/v1/host-sync — returns tombstone for deleted host", async () => {
    // Import a host to delete
    const importRes = await app.inject({
      method: "POST",
      url: "/api/v1/hosts/import",
      cookies: { [authCookie.name]: authCookie.value },
      payload: {
        label: "Tombstone Test",
        connection: {
          ...testOffer,
          serverId: "srv_tomb_01JABCDEFGHIJKLMNOP",
          daemonPublicKeyB64: "dG9tYnN0b25lLXB1YmxpYy1rZXk=",
        },
        clientVerification: { verifiedAt: "2026-08-11T13:00:00Z", serverVersion: "0.3.0" },
        idempotencyKey: "idem-tomb-001",
      },
    });
    const hostId = importRes.json().host.id;

    // Delete it
    await app.inject({
      method: "DELETE",
      url: `/api/v1/hosts/${hostId}`,
      cookies: { [authCookie.name]: authCookie.value },
    });

    // Sync should include the tombstone
    const syncRes = await app.inject({
      method: "GET",
      url: "/api/v1/host-sync?after=0",
      cookies: { [authCookie.name]: authCookie.value },
    });

    expect(syncRes.statusCode).toBe(200);
    const changes = syncRes.json().changes;
    const tombstone = changes.find(
      (c: { operation: string; hostId: string }) => c.operation === "delete" && c.hostId === hostId,
    );
    expect(tombstone).toBeDefined();
    expect(tombstone.deletedAt).toBeTruthy();
  });
});
