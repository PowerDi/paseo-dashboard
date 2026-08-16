import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const SCHEMA_VERSION = 1;
const KEY_PARTS = 2;

export interface EncryptResult {
  payload: string;
  dek: string;
  nonce: string;
  tag: string;
}

export interface EncryptedPayload {
  payload: string;
  dek: string;
  nonce: string;
  tag: string;
}

export interface EncryptionAadContext {
  userId: string;
  hostId: string;
  connId: string;
  keyVersion: string;
}

export class EnvelopeEncryptor {
  constructor(private kek: Buffer) {}

  encrypt(plaintextJson: string, aadCtx: EncryptionAadContext): EncryptResult {
    const dek = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, nonce);
    cipher.setAAD(this.buildAad(aadCtx));
    const encryptedPayload = Buffer.concat([cipher.update(plaintextJson, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      payload: encryptedPayload.toString("base64"),
      dek: this.wrapDek(dek),
      nonce: nonce.toString("base64"),
      tag: tag.toString("base64"),
    };
  }

  decrypt(encrypted: EncryptedPayload, aadCtx: EncryptionAadContext): string {
    const dek = this.unwrapDek(encrypted.dek);
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(encrypted.nonce, "base64"));
    decipher.setAAD(this.buildAad(aadCtx));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.payload, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  wrapDek(dek: Buffer): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.kek, nonce);
    const wrappedDek = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([wrappedDek, tag, nonce]).toString("base64");
  }

  unwrapDek(encryptedDek: string): Buffer {
    const blob = Buffer.from(encryptedDek, "base64");
    const wrappedDek = blob.subarray(0, 32);
    const tag = blob.subarray(32, 48);
    const nonce = blob.subarray(48, 60);
    const decipher = createDecipheriv("aes-256-gcm", this.kek, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrappedDek), decipher.final()]);
  }

  private buildAad(ctx: EncryptionAadContext): Buffer {
    return Buffer.from(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        userId: ctx.userId,
        hostId: ctx.hostId,
        connId: ctx.connId,
        keyVersion: ctx.keyVersion,
      }),
      "utf8",
    );
  }
}

export function capabilityFingerprint(secret: Buffer, connectionJson: string): string {
  return createHash("sha256").update(secret).update(connectionJson).digest("hex");
}

export function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export { KEY_PARTS };
