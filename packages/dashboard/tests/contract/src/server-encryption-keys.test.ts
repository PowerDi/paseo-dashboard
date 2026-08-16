import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import { KeyProviderSet, type AwsKmsTransport } from "@getpaseo/dashboard-server/lib/key-provider";

interface SessionCookie {
  name: string;
  value: string;
}

const cleanupPaths: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "paseo-board-encryption-"));
  cleanupPaths.push(root);
  return root;
}

function makeConfig(dataDir: string, kekFile: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir,
    logLevel: "silent",
    corsOrigin: "*",
    kekFile,
    keyProvider: "file",
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
}

function device(installationId: string) {
  return { installationId, name: installationId, platform: "web" };
}

async function register(
  app: ReturnType<typeof buildApp>,
  email: string,
  password: string,
  installationId: string,
): Promise<SessionCookie> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password, device: device(installationId) },
  });
  expect(response.statusCode).toBe(200);
  return response.cookies[0];
}

function connection(serverId: string, publicKey: string) {
  return {
    type: "relay",
    serverId,
    relayEndpoint: "relay.paseo.sh:443",
    useTls: true,
    daemonPublicKeyB64: publicKey,
  };
}

async function importHost(
  app: ReturnType<typeof buildApp>,
  cookie: SessionCookie,
  label: string,
  serverId: string,
  publicKey: string,
  idempotencyKey: string,
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/hosts/import",
    cookies: { [cookie.name]: cookie.value },
    payload: {
      label,
      connection: connection(serverId, publicKey),
      clientVerification: {
        verifiedAt: "2026-08-16T08:00:00.000Z",
        serverVersion: "0.3.0",
      },
      idempotencyKey,
    },
  });
}

class FakeAwsKmsTransport implements AwsKmsTransport {
  private counter = 0;
  private materials = new Map<string, { key: Buffer; context: string }>();
  readonly plaintextKeys = new Map<string, Buffer>();

  async generateDataKey(
    keyId: string,
    encryptionContext: Record<string, string>,
  ): Promise<{ plaintext: Uint8Array; ciphertextBlob: Uint8Array }> {
    this.counter += 1;
    const version = encryptionContext.paseoDashboardKeyVersion;
    const key = Buffer.alloc(32, this.counter);
    const blob = Buffer.from(`${keyId}:${version}:${this.counter}`, "utf8");
    this.materials.set(blob.toString("base64"), {
      key,
      context: JSON.stringify(encryptionContext),
    });
    this.plaintextKeys.set(version, key);
    return { plaintext: key, ciphertextBlob: blob };
  }

  async decrypt(
    ciphertextBlob: Uint8Array,
    encryptionContext: Record<string, string>,
  ): Promise<Uint8Array> {
    const material = this.materials.get(Buffer.from(ciphertextBlob).toString("base64"));
    if (!material || material.context !== JSON.stringify(encryptionContext)) {
      throw new Error("fake KMS context mismatch");
    }
    return material.key;
  }
}

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("Encryption key management", () => {
  it("rotates a file KEK online, preserves fingerprints, and restores without the retired key", async () => {
    const root = makeRoot();
    const dataDir = join(root, "data");
    const keyDir = join(root, "keys");
    mkdirSync(keyDir, { recursive: true });
    const key1 = join(keyDir, "k1");
    const key2 = join(keyDir, "k2");
    writeFileSync(key1, randomBytes(32), { mode: 0o600 });
    writeFileSync(key2, randomBytes(32), { mode: 0o600 });
    const config = makeConfig(dataDir, key1);

    let app = buildApp(config);
    let appClosed = false;
    try {
      await app.ready();
      const admin = await register(
        app,
        "admin@encryption.test",
        "password-admin-123",
        "admin-device",
      );
      const member = await register(
        app,
        "member@encryption.test",
        "password-member-123",
        "member-device",
      );

      const firstImport = await importHost(
        app,
        admin,
        "Before rotation",
        "server-before-rotation",
        "cHVibGljLWtleS1iZWZvcmU=",
        "before-rotation",
      );
      expect(firstImport.statusCode).toBe(200);

      const initialStatus = await app.inject({
        method: "GET",
        url: "/api/v1/admin/encryption-keys",
        cookies: { [admin.name]: admin.value },
      });
      expect(initialStatus.statusCode).toBe(200);
      expect(initialStatus.json()).toMatchObject({
        rotationProvider: "file",
        activeVersion: "k1",
        keys: [{ id: "k1", status: "active", encryptedConnectionCount: 1 }],
      });

      const memberStatus = await app.inject({
        method: "GET",
        url: "/api/v1/admin/encryption-keys",
        cookies: { [member.name]: member.value },
      });
      expect(memberStatus.statusCode).toBe(403);

      const wrongPassword = await app.inject({
        method: "POST",
        url: "/api/v1/admin/encryption-keys/rotate",
        cookies: { [admin.name]: admin.value },
        payload: { currentPassword: "wrong-password", keyFile: key2 },
      });
      expect(wrongPassword.statusCode).toBe(401);

      const sameKey = await app.inject({
        method: "POST",
        url: "/api/v1/admin/encryption-keys/rotate",
        cookies: { [admin.name]: admin.value },
        payload: { currentPassword: "password-admin-123", keyFile: key1 },
      });
      expect(sameKey.statusCode).toBe(400);
      expect(sameKey.json().error.message).toContain("必须与当前 active key 不同");

      const rotation = await app.inject({
        method: "POST",
        url: "/api/v1/admin/encryption-keys/rotate",
        cookies: { [admin.name]: admin.value },
        payload: { currentPassword: "password-admin-123", keyFile: key2 },
      });
      expect(rotation.statusCode).toBe(200);
      expect(rotation.json()).toMatchObject({
        result: {
          previousVersion: "k1",
          activeVersion: "k2",
          retiredVersion: "k1",
          rewrappedConnections: 1,
        },
        keys: [
          { id: "k1", status: "retired", encryptedConnectionCount: 0 },
          { id: "k2", status: "active", encryptedConnectionCount: 1 },
        ],
      });

      const existingHosts = await app.inject({
        method: "GET",
        url: "/api/v1/hosts",
        cookies: { [admin.name]: admin.value },
      });
      expect(existingHosts.statusCode).toBe(200);
      expect(existingHosts.json()[0].connection.serverId).toBe("server-before-rotation");

      const duplicateCapability = await importHost(
        app,
        admin,
        "Duplicate after rotation",
        "server-before-rotation",
        "cHVibGljLWtleS1iZWZvcmU=",
        "duplicate-after-rotation",
      );
      expect(duplicateCapability.statusCode).toBe(409);

      const secondImport = await importHost(
        app,
        admin,
        "After rotation",
        "server-after-rotation",
        "cHVibGljLWtleS1hZnRlcg==",
        "after-rotation",
      );
      expect(secondImport.statusCode).toBe(200);

      const sql = new Database(join(dataDir, "dashboard.db"), { readonly: true });
      const connectionRows = sql
        .prepare(
          `SELECT h.label, c.key_version AS keyVersion,
                  c.payload_key_version AS payloadKeyVersion
           FROM hosts h
           JOIN host_connections c ON c.host_id = h.id
           ORDER BY h.label`,
        )
        .all() as Array<{ label: string; keyVersion: string; payloadKeyVersion: string }>;
      expect(connectionRows).toEqual([
        { label: "After rotation", keyVersion: "k2", payloadKeyVersion: "k2" },
        { label: "Before rotation", keyVersion: "k2", payloadKeyVersion: "k1" },
      ]);
      expect(
        sql
          .prepare("SELECT key_version AS keyVersion FROM encryption_secrets WHERE id = ?")
          .get("capability-fingerprint-v1"),
      ).toEqual({ keyVersion: "k2" });
      expect(
        sql
          .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE type = ?")
          .get("encryption_key.rotated"),
      ).toEqual({ count: 1 });
      sql.close();

      await app.close();
      appClosed = true;
      rmSync(key1);

      const restoredDataDir = join(root, "restored-data");
      mkdirSync(restoredDataDir, { recursive: true });
      copyFileSync(join(dataDir, "dashboard.db"), join(restoredDataDir, "dashboard.db"));

      app = buildApp({ ...config, dataDir: restoredDataDir });
      appClosed = false;
      await app.ready();
      const restoredHosts = await app.inject({
        method: "GET",
        url: "/api/v1/hosts",
        cookies: { [admin.name]: admin.value },
      });
      expect(restoredHosts.statusCode).toBe(200);
      expect(
        restoredHosts
          .json()
          .map((host: { label: string }) => host.label)
          .sort(),
      ).toEqual(["After rotation", "Before rotation"]);
    } finally {
      if (!appClosed) await app.close();
    }
  });

  it("migrates legacy encrypted rows without changing capability fingerprints", async () => {
    const root = makeRoot();
    const dataDir = join(root, "data");
    const keyPath = join(root, "legacy-kek");
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
    const config = makeConfig(dataDir, keyPath);

    let app = buildApp(config);
    let appClosed = false;
    try {
      await app.ready();
      const admin = await register(
        app,
        "admin@legacy-encryption.test",
        "password-admin-123",
        "legacy-admin-device",
      );
      expect(
        (
          await importHost(
            app,
            admin,
            "Legacy host",
            "server-legacy",
            "cHVibGljLWtleS1sZWdhY3k=",
            "legacy-host",
          )
        ).statusCode,
      ).toBe(200);

      await app.close();
      appClosed = true;

      const sql = new Database(join(dataDir, "dashboard.db"));
      sql.exec(`
        DROP TABLE encryption_secrets;
        DROP INDEX IF EXISTS encryption_key_active_idx;
        DROP TABLE encryption_key_versions;
        ALTER TABLE host_connections DROP COLUMN payload_key_version;
      `);
      sql.close();

      app = buildApp(config);
      appClosed = false;
      await app.ready();

      const hosts = await app.inject({
        method: "GET",
        url: "/api/v1/hosts",
        cookies: { [admin.name]: admin.value },
      });
      expect(hosts.statusCode).toBe(200);
      expect(hosts.json()[0].connection.serverId).toBe("server-legacy");

      const duplicate = await importHost(
        app,
        admin,
        "Legacy duplicate",
        "server-legacy",
        "cHVibGljLWtleS1sZWdhY3k=",
        "legacy-duplicate",
      );
      expect(duplicate.statusCode).toBe(409);

      const migrated = new Database(join(dataDir, "dashboard.db"), { readonly: true });
      expect(
        migrated
          .prepare(
            "SELECT key_version AS keyVersion, payload_key_version AS payloadKeyVersion FROM host_connections",
          )
          .get(),
      ).toEqual({ keyVersion: "k1", payloadKeyVersion: "k1" });
      migrated.close();
    } finally {
      if (!appClosed) await app.close();
    }
  });

  it("resumes an interrupted decrypt-only rotation without a new file argument", async () => {
    const root = makeRoot();
    const dataDir = join(root, "data");
    const key1 = join(root, "resume-k1");
    const key2 = join(root, "resume-k2");
    writeFileSync(key1, randomBytes(32), { mode: 0o600 });
    writeFileSync(key2, randomBytes(32), { mode: 0o600 });
    const config = makeConfig(dataDir, key1);

    let app = buildApp(config);
    let appClosed = false;
    try {
      await app.ready();
      const admin = await register(
        app,
        "admin@resume-encryption.test",
        "password-admin-123",
        "resume-admin-device",
      );
      expect(
        (
          await importHost(
            app,
            admin,
            "Interrupted host",
            "server-interrupted",
            "cHVibGljLWtleS1pbnRlcnJ1cHRlZA==",
            "interrupted-host",
          )
        ).statusCode,
      ).toBe(200);

      await app.close();
      appClosed = true;

      const sql = new Database(join(dataDir, "dashboard.db"));
      const now = new Date().toISOString();
      sql.transaction(() => {
        sql
          .prepare("UPDATE encryption_key_versions SET status = 'decrypt_only' WHERE id = 'k1'")
          .run();
        sql
          .prepare(
            `INSERT INTO encryption_key_versions
              (id, version, provider, key_ref, status, created_at, retired_at)
             VALUES ('k2', 2, 'file', ?, 'active', ?, NULL)`,
          )
          .run(key2, now);
      })();
      sql.close();

      app = buildApp(config);
      appClosed = false;
      await app.ready();
      const resumed = await app.inject({
        method: "POST",
        url: "/api/v1/admin/encryption-keys/rotate",
        cookies: { [admin.name]: admin.value },
        payload: { currentPassword: "password-admin-123" },
      });
      expect(resumed.statusCode).toBe(200);
      expect(resumed.json()).toMatchObject({
        result: {
          previousVersion: "k1",
          activeVersion: "k2",
          retiredVersion: "k1",
          rewrappedConnections: 1,
        },
      });

      const hosts = await app.inject({
        method: "GET",
        url: "/api/v1/hosts",
        cookies: { [admin.name]: admin.value },
      });
      expect(hosts.statusCode).toBe(200);
      expect(hosts.json()[0].connection.serverId).toBe("server-interrupted");
    } finally {
      if (!appClosed) await app.close();
    }
  });

  it("stores only AWS KMS ciphertext references and can decrypt after restart", async () => {
    const root = makeRoot();
    const dataDir = join(root, "data");
    const transport = new FakeAwsKmsTransport();
    const config: ServerConfig = {
      ...makeConfig(dataDir, ""),
      keyProvider: "aws-kms",
      awsKmsKeyId: "alias/paseo-dashboard-test",
      awsKmsRegion: "us-east-1",
    };
    const makeProviders = () =>
      new KeyProviderSet({
        activeProvider: "aws-kms",
        dataDir,
        kekFile: "",
        awsKmsKeyId: config.awsKmsKeyId,
        awsKmsRegion: config.awsKmsRegion,
        awsKmsTransport: transport,
      });

    let app = buildApp(config, { keyProviders: makeProviders() });
    let appClosed = false;
    try {
      await app.ready();
      const admin = await register(app, "admin@kms.test", "password-admin-123", "kms-admin-device");
      expect(
        (await importHost(app, admin, "KMS host", "server-kms", "cHVibGljLWtleS1rbXM=", "kms-host"))
          .statusCode,
      ).toBe(200);

      const rotation = await app.inject({
        method: "POST",
        url: "/api/v1/admin/encryption-keys/rotate",
        cookies: { [admin.name]: admin.value },
        payload: { currentPassword: "password-admin-123" },
      });
      expect(rotation.statusCode).toBe(200);
      expect(rotation.json().result.activeVersion).toBe("k2");

      const sql = new Database(join(dataDir, "dashboard.db"), { readonly: true });
      const rows = sql
        .prepare(
          "SELECT id, provider, key_ref AS keyRef, status FROM encryption_key_versions ORDER BY version",
        )
        .all() as Array<{
        id: string;
        provider: string;
        keyRef: string;
        status: string;
      }>;
      expect(rows).toMatchObject([
        { id: "k1", provider: "aws-kms", status: "retired" },
        { id: "k2", provider: "aws-kms", status: "active" },
      ]);
      expect(rows[1].keyRef).not.toBe(transport.plaintextKeys.get("k2")!.toString("base64"));
      sql.close();

      await app.close();
      appClosed = true;
      app = buildApp(config, { keyProviders: makeProviders() });
      appClosed = false;
      await app.ready();

      const hosts = await app.inject({
        method: "GET",
        url: "/api/v1/hosts",
        cookies: { [admin.name]: admin.value },
      });
      expect(hosts.statusCode).toBe(200);
      expect(hosts.json()[0].connection.serverId).toBe("server-kms");
    } finally {
      if (!appClosed) await app.close();
    }
  });

  it("rate-limits repeated admin rotation attempts by IP", async () => {
    const root = makeRoot();
    const dataDir = join(root, "data");
    const keyPath = join(root, "rate-limit-k1");
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
    const config = { ...makeConfig(dataDir, keyPath), rateLimitEnabled: true };
    const app = buildApp(config);
    try {
      await app.ready();
      const admin = await register(
        app,
        "admin@rotation-rate-limit.test",
        "password-admin-123",
        "rotation-rate-limit-device",
      );

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/admin/encryption-keys/rotate",
          cookies: { [admin.name]: admin.value },
          payload: { currentPassword: "wrong-password", keyFile: keyPath },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await app.close();
    }
  });

  it("rejects production-style file bootstrap without an explicit KEK", async () => {
    const root = makeRoot();
    const providers = new KeyProviderSet({
      activeProvider: "file",
      dataDir: join(root, "data"),
      kekFile: "",
      allowGeneratedFileKey: false,
    });

    await expect(providers.bootstrap("k1")).rejects.toThrow(
      "生产环境的 file KeyProvider 必须设置 PASEO_BOARD_KEK_FILE",
    );
  });
});
