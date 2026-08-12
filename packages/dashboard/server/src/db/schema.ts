import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  emailNormalized: text("email_normalized").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  status: text("status", { enum: ["active", "locked", "pending_delete"] })
    .notNull()
    .default("active"),
  syncRevision: integer("sync_revision").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
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
