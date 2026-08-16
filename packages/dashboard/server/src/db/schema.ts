import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  emailNormalized: text("email_normalized").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member"] })
    .notNull()
    .default("member"),
  status: text("status", { enum: ["active", "locked", "pending_delete"] })
    .notNull()
    .default("active"),
  syncRevision: integer("sync_revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  emailNormalized: text("email_normalized").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  revokedAt: text("revoked_at"),
});

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    installationIdHash: text("installation_id_hash").notNull(),
    displayName: text("display_name").notNull(),
    platform: text("platform").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    lastIpPrefix: text("last_ip_prefix"),
    lastUserAgentSummary: text("last_user_agent_summary"),
    lastAuthMethod: text("last_auth_method", { enum: ["password", "passkey"] }),
    lastSyncedRevision: integer("last_synced_revision").notNull().default(0),
    revokedAt: text("revoked_at"),
  },
  (t) => [uniqueIndex("devices_user_installation_idx").on(t.userId, t.installationIdHash)],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id),
  accessTokenHash: text("access_token_hash").notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  familyId: text("family_id").notNull(),
  rotationCounter: integer("rotation_counter").notNull().default(0),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(), // access token 过期
  refreshExpiresAt: text("refresh_expires_at").notNull(), // refresh token 过期
  lastUsedAt: text("last_used_at").notNull(),
  revokedAt: text("revoked_at"),
  ipPrefix: text("ip_prefix"),
  userAgentSummary: text("user_agent_summary"),
  authMethod: text("auth_method", { enum: ["password", "passkey"] })
    .notNull()
    .default("password"),
});

export const passkeys = sqliteTable("passkeys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  credentialId: text("credential_id").notNull().unique(),
  publicKeyB64: text("public_key_b64").notNull(),
  counter: integer("counter").notNull().default(0),
  transports: text("transports").notNull().default("[]"),
  deviceType: text("device_type", { enum: ["singleDevice", "multiDevice"] }).notNull(),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull().default(false),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
});

export const webauthnChallenges = sqliteTable("webauthn_challenges", {
  id: text("id").primaryKey(),
  purpose: text("purpose", { enum: ["registration", "authentication"] }).notNull(),
  userId: text("user_id"),
  sessionId: text("session_id"),
  challengeHash: text("challenge_hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

export const hosts = sqliteTable("hosts", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id),
  label: text("label").notNull(),
  version: integer("version").notNull().default(1),
  lastSyncRevision: integer("last_sync_revision").notNull().default(0),
  capabilityFingerprint: text("capability_fingerprint"),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const encryptionKeyVersions = sqliteTable("encryption_key_versions", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().unique(),
  provider: text("provider", { enum: ["file", "aws-kms"] }).notNull(),
  keyRef: text("key_ref").notNull(),
  status: text("status", { enum: ["active", "decrypt_only", "retired"] }).notNull(),
  createdAt: text("created_at").notNull(),
  retiredAt: text("retired_at"),
});

export const encryptionSecrets = sqliteTable("encryption_secrets", {
  id: text("id").primaryKey(),
  encryptedValue: text("encrypted_value").notNull(),
  nonce: text("nonce").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: text("key_version").notNull(),
});

export const hostConnections = sqliteTable("host_connections", {
  id: text("id").primaryKey(),
  hostId: text("host_id")
    .notNull()
    .references(() => hosts.id)
    .unique(),
  kind: text("kind", { enum: ["relay"] }).notNull(),
  encryptedPayload: text("encrypted_payload").notNull(),
  encryptedDek: text("encrypted_dek").notNull(),
  keyVersion: text("key_version").notNull(),
  payloadKeyVersion: text("payload_key_version").notNull(),
  nonce: text("nonce").notNull(),
  authTag: text("auth_tag").notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  deviceId: text("device_id"),
  sessionId: text("session_id"),
  type: text("type").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
});
