import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const SCHEMA_VERSION = 1;
const KEY_PARTS = 2; // DEK (32B key + payload) + KEK wrapping

export interface EncryptResult {
  payload: string; // base64 ciphertext
  dek: string; // base64 DEK (plaintext, for wrapping)
  nonce: string; // base64
  tag: string; // base64 auth tag
}

// Envelope encryption: AEAD per row with a unique DEK, wrapped by a KEK.
// AAD binds ciphertext to (schemaVersion, userId, hostId, connId, keyVersion)
// to prevent ciphertext shuffling.
export class EnvelopeEncryptor {
  constructor(private kek: Buffer) {}

  encrypt(
    plaintextJson: string,
    aadCtx: { userId: string; hostId: string; connId: string; keyVersion: string },
  ): EncryptResult {
    const dek = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, nonce);
    cipher.setAAD(this.buildAad(aadCtx));
    const enc = Buffer.concat([cipher.update(plaintextJson, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Wrap DEK with KEK
    const dekNonce = randomBytes(12);
    const dekCipher = createCipheriv("aes-256-gcm", this.kek, dekNonce);
    const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
    const dekTag = dekCipher.getAuthTag();

    return {
      payload: enc.toString("base64"),
      dek: Buffer.concat([wrappedDek, dekTag, dekNonce]).toString("base64"),
      nonce: nonce.toString("base64"),
      tag: tag.toString("base64"),
    };
  }

  decrypt(
    encrypted: { payload: string; dek: string; nonce: string; tag: string },
    aadCtx: { userId: string; hostId: string; connId: string; keyVersion: string },
  ): string {
    // Unwrap DEK
    const blob = Buffer.from(encrypted.dek, "base64");
    const wrappedDek = blob.subarray(0, 32);
    const dekTag = blob.subarray(32, 48);
    const dekNonce = blob.subarray(48, 60);
    const dekCipher = createDecipheriv("aes-256-gcm", this.kek, dekNonce);
    dekCipher.setAuthTag(dekTag);
    const dek = Buffer.concat([dekCipher.update(wrappedDek), dekCipher.final()]);

    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(encrypted.nonce, "base64"));
    decipher.setAAD(this.buildAad(aadCtx));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.payload, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private buildAad(ctx: {
    userId: string;
    hostId: string;
    connId: string;
    keyVersion: string;
  }): Buffer {
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

// HMAC fingerprint for dedup; not reversible to the raw serverId.
export function capabilityFingerprint(secret: Buffer, connectionJson: string): string {
  return createHash("sha256", secret).update(connectionJson).digest("hex");
}

// Unsafe util for tests / HMAC secret derivation.
export function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export { KEY_PARTS };
