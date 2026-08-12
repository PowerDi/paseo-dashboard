import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import type { SyncResponse } from "@getpaseo/dashboard-shared";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "paseo-sync-test-"));
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

function makeConnection(serverId: string, keyB64: string) {
  return {
    type: "relay" as const,
    serverId,
    relayEndpoint: "relay.paseo.sh:443",
    useTls: true,
    daemonPublicKeyB64: keyB64,
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
      connection: makeConnection(serverId, randomBytes(16).toString("base64")),
      clientVerification: { verifiedAt: new Date().toISOString(), serverVersion: "0.3.0" },
      idempotencyKey: `idem-${serverId}`,
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    host: { id: string; label: string; version: number };
    syncRevision: number;
  };
}

async function sync(
  app: ReturnType<typeof buildApp>,
  cookie: { name: string; value: string },
  after: number,
  limit?: number,
): Promise<SyncResponse> {
  const url = `/api/v1/host-sync?after=${after}${limit ? `&limit=${limit}` : ""}`;
  const res = await app.inject({
    method: "GET",
    url,
    cookies: { [cookie.name]: cookie.value },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as SyncResponse;
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
    payload: {
      email,
      password,
      device: { installationId, name: "Device B", platform: "web" },
    },
  });
  expect(res.statusCode).toBe(200);
  return res.cookies[0];
}

describe("Host incremental sync (P2.1)", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;
  let cookieA: { name: string; value: string };
  const email = "sync-test@example.com";
  const password = "test-password-123";

  beforeAll(async () => {
    const cfg = makeTestConfig();
    cleanup = cfg.cleanup;
    app = buildApp(cfg.config);
    await app.ready();

    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email,
        password,
        device: { installationId: "dev-A", name: "Device A", platform: "web" },
      },
    });
    expect(regRes.statusCode).toBe(200);
    cookieA = regRes.cookies[0];
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("initial sync returns empty when no hosts exist", async () => {
    const res = await sync(app, cookieA, 0);
    expect(res.fromRevision).toBe(0);
    expect(res.toRevision).toBe(0);
    expect(res.changes).toHaveLength(0);
    expect(res.hasMore).toBe(false);
  });

  it("sync returns upsert after import", async () => {
    const imported = await importHost(app, cookieA, "srv-001", "Host One");

    const res = await sync(app, cookieA, 0);
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0].operation).toBe("upsert");
    expect(res.changes[0].revision).toBe(imported.syncRevision);
    expect(res.toRevision).toBe(imported.syncRevision);
    expect(res.hasMore).toBe(false);
  });

  it("sync with cursor returns empty when caught up", async () => {
    const prev = await sync(app, cookieA, 0);
    const after = prev.toRevision;

    const res = await sync(app, cookieA, after);
    expect(res.changes).toHaveLength(0);
    expect(res.toRevision).toBe(after);
    expect(res.hasMore).toBe(false);
  });

  it("sync returns upsert after host update with higher revision", async () => {
    const imported = await importHost(app, cookieA, "srv-002", "Host Two");
    // Sync to catch up
    let res = await sync(app, cookieA, 0);
    const afterFirst = res.toRevision;
    expect(afterFirst).toBe(imported.syncRevision);

    // Update the host
    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/hosts/${imported.host.id}`,
      cookies: { [cookieA.name]: cookieA.value },
      payload: { label: "Host Two Renamed", baseVersion: 1 },
    });
    expect(updateRes.statusCode).toBe(200);

    // Incremental sync should return only the updated host
    res = await sync(app, cookieA, afterFirst);
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0].operation).toBe("upsert");
    expect(res.changes[0].revision).toBeGreaterThan(afterFirst);
    if (res.changes[0].operation === "upsert") {
      expect(res.changes[0].host.label).toBe("Host Two Renamed");
    }
  });

  it("sync returns delete tombstone after host deletion", async () => {
    const imported = await importHost(app, cookieA, "srv-003", "Host Three");
    // Catch up
    let res = await sync(app, cookieA, 0);
    const afterImport = res.toRevision;

    // Delete the host
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/hosts/${imported.host.id}`,
      cookies: { [cookieA.name]: cookieA.value },
    });
    expect(delRes.statusCode).toBe(200);

    // Incremental sync should return the tombstone
    res = await sync(app, cookieA, afterImport);
    const deleteChange = res.changes.find((c) => c.operation === "delete");
    expect(deleteChange).toBeDefined();
    if (deleteChange && deleteChange.operation === "delete") {
      expect(deleteChange.hostId).toBe(imported.host.id);
      expect(deleteChange.revision).toBeGreaterThan(afterImport);
      expect(deleteChange.deletedAt).toBeTruthy();
    }
  });

  it("multi-device: device B sees changes made by device A", async () => {
    // Device A imports a host
    const imported = await importHost(app, cookieA, "srv-multi", "Multi Host");

    // Device B logs in
    const cookieB = await loginSecondDevice(app, email, password, "dev-B");

    // Device B does initial sync
    const res = await sync(app, cookieB, 0);
    const upsert = res.changes.find(
      (c) => c.operation === "upsert" && c.host.id === imported.host.id,
    );
    expect(upsert).toBeDefined();
    expect(res.toRevision).toBe(imported.syncRevision);
  });

  it("pagination: hasMore works with limit", async () => {
    // Record current revision so we only paginate over the new hosts
    const beforePage = await sync(app, cookieA, 0, 500);
    const base = beforePage.toRevision;

    // Import 3 hosts with unique fingerprints to exceed limit=2
    await importHost(app, cookieA, "srv-page-1", "Page Host 1");
    await importHost(app, cookieA, "srv-page-2", "Page Host 2");
    await importHost(app, cookieA, "srv-page-3", "Page Host 3");

    // First page with limit=2
    const page1 = await sync(app, cookieA, base, 2);
    expect(page1.changes.length).toBe(2);
    expect(page1.hasMore).toBe(true);

    const lastRev1 = page1.changes[page1.changes.length - 1].revision;
    expect(lastRev1).toBeGreaterThan(base);

    // Second page
    const page2 = await sync(app, cookieA, lastRev1, 2);
    expect(page2.changes.length).toBe(1);
    expect(page2.hasMore).toBe(false);
  });

  it("idempotent: re-syncing same cursor produces same changes", async () => {
    const res1 = await sync(app, cookieA, 0, 500);
    const res2 = await sync(app, cookieA, 0, 500);
    expect(res1.changes.length).toBe(res2.changes.length);
    expect(res1.toRevision).toBe(res2.toRevision);
  });
});
