import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";

export function ensureTables(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(`${dataDir}/dashboard.db`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','locked','pending_delete')),
      sync_revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      email_normalized TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations(email_normalized);

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      installation_id_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_ip_prefix TEXT,
      last_user_agent_summary TEXT,
      last_auth_method TEXT CHECK(last_auth_method IN ('password','passkey')),
      last_synced_revision INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS devices_user_installation_idx ON devices(user_id, installation_id_hash);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      device_id TEXT NOT NULL REFERENCES devices(id),
      access_token_hash TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      family_id TEXT NOT NULL,
      rotation_counter INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      refresh_expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      revoked_at TEXT,
      ip_prefix TEXT,
      user_agent_summary TEXT,
      auth_method TEXT NOT NULL DEFAULT 'password' CHECK(auth_method IN ('password','passkey'))
    );
    CREATE INDEX IF NOT EXISTS sessions_family_idx ON sessions(family_id);
    CREATE INDEX IF NOT EXISTS sessions_refresh_hash_idx ON sessions(refresh_token_hash);
    CREATE INDEX IF NOT EXISTS sessions_access_hash_idx ON sessions(access_token_hash);

    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      credential_id TEXT NOT NULL UNIQUE,
      public_key_b64 TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      device_type TEXT NOT NULL CHECK(device_type IN ('singleDevice','multiDevice')),
      backed_up INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id);

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL CHECK(purpose IN ('registration','authentication')),
      user_id TEXT,
      session_id TEXT,
      challenge_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry_idx
      ON webauthn_challenges(expires_at);

    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      label TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      last_sync_revision INTEGER NOT NULL DEFAULT 0,
      capability_fingerprint TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS hosts_owner_idx ON hosts(owner_user_id);
    CREATE INDEX IF NOT EXISTS hosts_fp_idx ON hosts(owner_user_id, capability_fingerprint);
    CREATE INDEX IF NOT EXISTS hosts_idem_idx ON hosts(owner_user_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS hosts_sync_revision_idx ON hosts(owner_user_id, last_sync_revision);

    CREATE TABLE IF NOT EXISTS host_connections (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL UNIQUE REFERENCES hosts(id),
      kind TEXT NOT NULL CHECK(kind = 'relay'),
      encrypted_payload TEXT NOT NULL,
      encrypted_dek TEXT NOT NULL,
      key_version TEXT NOT NULL,
      nonce TEXT NOT NULL,
      auth_tag TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT,
      session_id TEXT,
      type TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_events(user_id);
    CREATE INDEX IF NOT EXISTS audit_type_idx ON audit_events(type);
  `);

  // Idempotent migration: add account roles and preserve an administrator
  // for existing single-user installations.
  const userCols = db.pragma("table_info(users)") as Array<{ name: string }>;
  if (!userCols.some((col) => col.name === "role")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member'))",
    );
  }
  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL LIMIT 1")
    .get();
  if (!existingAdmin) {
    db.exec(`
      UPDATE users
      SET role = 'admin'
      WHERE id = (
        SELECT id FROM users
        WHERE deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      )
    `);
  }

  // Idempotent migration: add created_at column to sessions table.
  const sessionCols = db.pragma("table_info(sessions)") as Array<{ name: string }>;
  if (!sessionCols.some((col) => col.name === "created_at")) {
    db.exec("ALTER TABLE sessions ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
  }
  if (!sessionCols.some((col) => col.name === "auth_method")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password' CHECK(auth_method IN ('password','passkey'))",
    );
  }

  // Idempotent migration: add last_synced_revision column to devices table.
  const deviceCols = db.pragma("table_info(devices)") as Array<{ name: string }>;
  if (!deviceCols.some((col) => col.name === "last_synced_revision")) {
    db.exec("ALTER TABLE devices ADD COLUMN last_synced_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!deviceCols.some((col) => col.name === "last_ip_prefix")) {
    db.exec("ALTER TABLE devices ADD COLUMN last_ip_prefix TEXT");
  }
  if (!deviceCols.some((col) => col.name === "last_user_agent_summary")) {
    db.exec("ALTER TABLE devices ADD COLUMN last_user_agent_summary TEXT");
  }
  if (!deviceCols.some((col) => col.name === "last_auth_method")) {
    db.exec(
      "ALTER TABLE devices ADD COLUMN last_auth_method TEXT CHECK(last_auth_method IN ('password','passkey'))",
    );
  }

  // Idempotent migration: add last_sync_revision column to existing databases.
  // SQLite doesn't support ADD COLUMN IF NOT EXISTS, so check pragma table_info.
  const hostCols = db.pragma("table_info(hosts)") as Array<{ name: string }>;
  if (!hostCols.some((col) => col.name === "last_sync_revision")) {
    db.exec("ALTER TABLE hosts ADD COLUMN last_sync_revision INTEGER NOT NULL DEFAULT 0");
    db.exec(
      "CREATE INDEX IF NOT EXISTS hosts_sync_revision_idx ON hosts(owner_user_id, last_sync_revision)",
    );
  }

  db.close();
}
