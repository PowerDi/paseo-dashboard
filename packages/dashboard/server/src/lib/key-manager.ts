import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { setImmediate as waitForNextTurn } from "node:timers/promises";
import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { encryptionKeyVersions, encryptionSecrets, hostConnections } from "../db/schema.js";
import {
  capabilityFingerprint,
  EnvelopeEncryptor,
  type EncryptedPayload,
  type EncryptionAadContext,
  type EncryptResult,
} from "./encryption.js";
import { assertDifferentKeys, type KeyProviderSet, type KeyProviderType } from "./key-provider.js";

const FINGERPRINT_SECRET_ID = "capability-fingerprint-v1";
const SECRET_SCHEMA_VERSION = 1;

type KeyVersionRow = typeof encryptionKeyVersions.$inferSelect;

type ManagedEncryptedPayload = EncryptedPayload & {
  keyVersion: string;
  payloadKeyVersion: string;
};

export interface KeyVersionStatus {
  id: string;
  version: number;
  provider: KeyProviderType;
  status: "active" | "decrypt_only" | "retired";
  createdAt: string;
  retiredAt: string | null;
  encryptedConnectionCount: number;
}

export interface RotationResult {
  previousVersion: string;
  activeVersion: string;
  provider: KeyProviderType;
  rewrappedConnections: number;
  retiredVersion: string;
}

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

function secretAad(keyVersion: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: SECRET_SCHEMA_VERSION,
      secretId: FINGERPRINT_SECRET_ID,
      keyVersion,
    }),
    "utf8",
  );
}

function encryptSecret(secret: Buffer, key: Buffer, keyVersion: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(secretAad(keyVersion));
  const encryptedValue = Buffer.concat([cipher.update(secret), cipher.final()]);
  return {
    encryptedValue: encryptedValue.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

function decryptSecret(encrypted: typeof encryptionSecrets.$inferSelect, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.nonce, "base64"));
  decipher.setAAD(secretAad(encrypted.keyVersion));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.encryptedValue, "base64")),
    decipher.final(),
  ]);
}

function legacyFingerprintSecret(key: Buffer): Buffer {
  return createHash("sha256").update(key).update("capability-fingerprint-v1").digest();
}

export class EncryptionKeyManager {
  private readonly keys = new Map<string, Buffer>();
  private rows = new Map<string, KeyVersionRow>();
  private fingerprintSecret: Buffer | null = null;
  private activeVersionId: string | null = null;
  private initialized = false;

  constructor(
    private db: Db,
    private providers: KeyProviderSet,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;

    let rows = await this.db
      .select()
      .from(encryptionKeyVersions)
      .orderBy(asc(encryptionKeyVersions.version));

    if (rows.length === 0) {
      const material = await this.providers.bootstrap("k1");
      const now = new Date().toISOString();
      await this.db.insert(encryptionKeyVersions).values({
        id: "k1",
        version: 1,
        provider: this.providers.activeProvider,
        keyRef: material.reference,
        status: "active",
        createdAt: now,
        retiredAt: null,
      });
      rows = await this.db
        .select()
        .from(encryptionKeyVersions)
        .orderBy(asc(encryptionKeyVersions.version));
    }

    const activeRows = rows.filter((row) => row.status === "active");
    if (activeRows.length !== 1) {
      throw new EncryptionKeyError(
        `加密 key registry 必须恰好有一个 active key（当前 ${activeRows.length} 个）`,
      );
    }

    this.rows = new Map(rows.map((row) => [row.id, row]));
    for (const row of rows.filter((candidate) => candidate.status !== "retired")) {
      const key = await this.providers.resolve(row.provider, row.keyRef, row.id);
      this.keys.set(row.id, key);
    }

    this.activeVersionId = activeRows[0].id;
    await this.ensureFingerprintSecret(this.activeVersionId);
    this.initialized = true;
  }

  get activeVersion(): string {
    this.ensureInitialized();
    return this.activeVersionId!;
  }

  get rotationProvider(): KeyProviderType {
    return this.providers.activeProvider;
  }

  get fingerprintSecretValue(): Buffer {
    this.ensureInitialized();
    return Buffer.from(this.fingerprintSecret!);
  }

  fingerprint(connectionJson: string): string {
    return capabilityFingerprint(this.fingerprintSecretValue, connectionJson);
  }

  encrypt(
    plaintextJson: string,
    context: Omit<EncryptionAadContext, "keyVersion">,
  ): ManagedEncryptedPayload {
    this.ensureInitialized();
    const keyVersion = this.activeVersion;
    const result: EncryptResult = new EnvelopeEncryptor(this.getKey(keyVersion)).encrypt(
      plaintextJson,
      { ...context, keyVersion },
    );
    return { ...result, keyVersion, payloadKeyVersion: keyVersion };
  }

  decrypt(
    encrypted: ManagedEncryptedPayload,
    context: Omit<EncryptionAadContext, "keyVersion">,
  ): string {
    this.ensureInitialized();
    const key = this.getKey(encrypted.keyVersion);
    return new EnvelopeEncryptor(key).decrypt(encrypted, {
      ...context,
      keyVersion: encrypted.payloadKeyVersion,
    });
  }

  async rotate(keyReference?: string): Promise<RotationResult> {
    this.ensureInitialized();
    const pending = [...this.rows.values()].find((row) => row.status === "decrypt_only");
    if (pending) {
      return this.finishRotation(pending);
    }

    const current = this.currentRow();
    const nextVersion = Math.max(...[...this.rows.values()].map((row) => row.version)) + 1;
    const nextId = `k${nextVersion}`;
    const material = await this.providers.create(nextId, keyReference);
    assertDifferentKeys(this.getKey(current.id), material.key);

    const now = new Date().toISOString();
    await this.db.transaction((tx) => {
      tx.update(encryptionKeyVersions)
        .set({ status: "decrypt_only" })
        .where(
          and(eq(encryptionKeyVersions.id, current.id), eq(encryptionKeyVersions.status, "active")),
        )
        .run();
      tx.insert(encryptionKeyVersions)
        .values({
          id: nextId,
          version: nextVersion,
          provider: this.providers.activeProvider,
          keyRef: material.reference,
          status: "active",
          createdAt: now,
          retiredAt: null,
        })
        .run();
    });

    const nextRow: KeyVersionRow = {
      id: nextId,
      version: nextVersion,
      provider: this.providers.activeProvider,
      keyRef: material.reference,
      status: "active",
      createdAt: now,
      retiredAt: null,
    };
    const pendingRow: KeyVersionRow = { ...current, status: "decrypt_only" };
    this.rows.set(current.id, pendingRow);
    this.rows.set(nextId, nextRow);
    this.keys.set(nextId, material.key);
    this.activeVersionId = nextId;

    return this.finishRotation(pendingRow);
  }

  async status(): Promise<KeyVersionStatus[]> {
    this.ensureInitialized();
    const connections = await this.db
      .select({ keyVersion: hostConnections.keyVersion })
      .from(hostConnections);
    const counts = new Map<string, number>();
    for (const connection of connections) {
      counts.set(connection.keyVersion, (counts.get(connection.keyVersion) ?? 0) + 1);
    }
    return [...this.rows.values()]
      .sort((left, right) => left.version - right.version)
      .map((row) => ({
        id: row.id,
        version: row.version,
        provider: row.provider,
        status: row.status,
        createdAt: row.createdAt,
        retiredAt: row.retiredAt,
        encryptedConnectionCount: counts.get(row.id) ?? 0,
      }));
  }

  async retire(versionId: string): Promise<void> {
    this.ensureInitialized();
    if (versionId === this.activeVersion) throw new EncryptionKeyError("不能退休 active key");
    const row = this.rows.get(versionId);
    if (!row || row.status === "retired")
      throw new EncryptionKeyError("key version 不存在或已退休");
    const connections = await this.db
      .select({ id: hostConnections.id })
      .from(hostConnections)
      .where(eq(hostConnections.keyVersion, versionId));
    const secrets = await this.db
      .select({ id: encryptionSecrets.id })
      .from(encryptionSecrets)
      .where(eq(encryptionSecrets.keyVersion, versionId));
    if (connections.length > 0 || secrets.length > 0) {
      throw new EncryptionKeyError("key version 仍被数据引用，必须先完成 rewrap");
    }
    const now = new Date().toISOString();
    await this.db
      .update(encryptionKeyVersions)
      .set({ status: "retired", retiredAt: now })
      .where(
        and(eq(encryptionKeyVersions.id, versionId), ne(encryptionKeyVersions.status, "retired")),
      );
    this.rows.set(versionId, { ...row, status: "retired", retiredAt: now });
    this.keys.delete(versionId);
  }

  private async finishRotation(previous: KeyVersionRow): Promise<RotationResult> {
    const active = this.currentRow();
    const oldKey = this.getKey(previous.id);
    const newKey = this.getKey(active.id);
    const oldEncryptor = new EnvelopeEncryptor(oldKey);
    const newEncryptor = new EnvelopeEncryptor(newKey);
    const oldConnections = await this.db
      .select()
      .from(hostConnections)
      .where(eq(hostConnections.keyVersion, previous.id));

    for (const connection of oldConnections) {
      const encryptedDek = newEncryptor.wrapDek(oldEncryptor.unwrapDek(connection.encryptedDek));
      await this.db
        .update(hostConnections)
        .set({ encryptedDek, keyVersion: active.id })
        .where(eq(hostConnections.id, connection.id));
      await waitForNextTurn();
    }

    await this.rewrapFingerprintSecret(previous.id, active.id, oldKey, newKey);
    await this.retire(previous.id);
    return {
      previousVersion: previous.id,
      activeVersion: active.id,
      provider: active.provider,
      rewrappedConnections: oldConnections.length,
      retiredVersion: previous.id,
    };
  }

  private async ensureFingerprintSecret(activeVersion: string): Promise<void> {
    const row = await this.db
      .select()
      .from(encryptionSecrets)
      .where(eq(encryptionSecrets.id, FINGERPRINT_SECRET_ID))
      .limit(1)
      .then((rows) => rows[0]);
    const activeKey = this.getKey(activeVersion);
    if (!row) {
      const secret = legacyFingerprintSecret(activeKey);
      await this.db.insert(encryptionSecrets).values({
        id: FINGERPRINT_SECRET_ID,
        ...encryptSecret(secret, activeKey, activeVersion),
      });
      this.fingerprintSecret = secret;
      return;
    }
    this.fingerprintSecret = decryptSecret(row, this.getKey(row.keyVersion));
  }

  private async rewrapFingerprintSecret(
    previousVersion: string,
    activeVersion: string,
    previousKey: Buffer,
    activeKey: Buffer,
  ): Promise<void> {
    const row = await this.db
      .select()
      .from(encryptionSecrets)
      .where(
        and(
          eq(encryptionSecrets.id, FINGERPRINT_SECRET_ID),
          eq(encryptionSecrets.keyVersion, previousVersion),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    if (!row) return;
    const secret = decryptSecret(row, previousKey);
    await this.db
      .update(encryptionSecrets)
      .set(encryptSecret(secret, activeKey, activeVersion))
      .where(eq(encryptionSecrets.id, FINGERPRINT_SECRET_ID));
    this.fingerprintSecret = secret;
  }

  private currentRow(): KeyVersionRow {
    const row = this.rows.get(this.activeVersion);
    if (!row) throw new EncryptionKeyError("active key material 未加载");
    return row;
  }

  private getKey(versionId: string): Buffer {
    const key = this.keys.get(versionId);
    if (!key) throw new EncryptionKeyError(`key version ${versionId} 不可用`);
    return key;
  }

  private ensureInitialized(): void {
    if (!this.initialized) throw new EncryptionKeyError("加密 key manager 尚未初始化");
  }
}
