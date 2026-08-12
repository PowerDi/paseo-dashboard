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
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','locked','pending_delete')),
      sync_revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      installation_id_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
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
      expires_at TEXT NOT NULL,
      refresh_expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      revoked_at TEXT,
      ip_prefix TEXT,
      user_agent_summary TEXT
    );
    CREATE INDEX IF NOT EXISTS sessions_family_idx ON sessions(family_id);
    CREATE INDEX IF NOT EXISTS sessions_refresh_hash_idx ON sessions(refresh_token_hash);
    CREATE INDEX IF NOT EXISTS sessions_access_hash_idx ON sessions(access_token_hash);

    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id),
      label TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      capability_fingerprint TEXT,
      idempotency_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS hosts_owner_idx ON hosts(owner_user_id);
    CREATE INDEX IF NOT EXISTS hosts_fp_idx ON hosts(owner_user_id, capability_fingerprint);
    CREATE INDEX IF NOT EXISTS hosts_idem_idx ON hosts(owner_user_id, idempotency_key);

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
  db.close();
}
