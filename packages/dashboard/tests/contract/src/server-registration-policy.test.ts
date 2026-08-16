import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeTestConfig(): { config: ServerConfig; cleanup: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), "paseo-registration-policy-test-"));
  const kekPath = join(dataDir, ".kek");
  writeFileSync(kekPath, randomBytes(32), { mode: 0o600 });

  return {
    config: {
      host: "127.0.0.1",
      port: 0,
      dataDir,
      logLevel: "silent",
      corsOrigin: "*",
      kekFile: kekPath,
      accessTokenTtl: 900,
      refreshTokenTtl: 7 * 24 * 3600,
      refreshTokenBytes: 32,
      argon2MemoryCost: 1024,
      argon2TimeCost: 1,
      argon2Parallelism: 1,
      registrationOpen: false,
      trustedProxies: [],
      rateLimitEnabled: false,
    },
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}

function device(installationId: string) {
  return { installationId, name: installationId, platform: "web" };
}

describe("Registration policy", () => {
  let app: ReturnType<typeof buildApp>;
  let sql: Database.Database;
  let cleanup: () => void;
  let adminCookie: { name: string; value: string };

  beforeEach(async () => {
    const testConfig = makeTestConfig();
    cleanup = testConfig.cleanup;
    app = buildApp(testConfig.config);
    await app.ready();
    sql = new Database(join(testConfig.config.dataDir, "dashboard.db"));

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "admin@registration-policy.test",
        password: "password-admin-123",
        device: device("admin-device"),
      },
    });
    expect(first.statusCode).toBe(200);
    adminCookie = first.cookies[0];
  });

  afterEach(async () => {
    sql.close();
    await app.close();
    cleanup();
  });

  async function createInvitation(email: string) {
    return app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { email },
    });
  }

  it("makes the first user admin and lets the admin invite a member", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { [adminCookie.name]: adminCookie.value },
    });
    expect(me.json().user.role).toBe("admin");

    const invitation = await createInvitation("member@registration-policy.test");
    expect(invitation.statusCode).toBe(201);
    expect(invitation.headers["cache-control"]).toBe("no-store");
    expect(invitation.json().token).toBeTruthy();
    const storedInvitation = sql
      .prepare("SELECT token_hash AS tokenHash FROM invitations WHERE id = ?")
      .get(invitation.json().invitation.id) as { tokenHash: string };
    expect(storedInvitation.tokenHash).not.toBe(invitation.json().token);
    expect(storedInvitation.tokenHash).toHaveLength(64);

    const member = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "member@registration-policy.test",
        password: "password-member-123",
        device: device("member-device"),
        inviteToken: invitation.json().token,
      },
    });
    expect(member.statusCode).toBe(200);
    expect(member.json().user.role).toBe("member");
  });

  it("rejects registration without an invitation when public registration is closed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "blocked@registration-policy.test",
        password: "password-blocked-123",
        device: device("blocked-device"),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("注册已关闭");
  });

  it("binds invitations to email and consumes them once", async () => {
    const invitation = await createInvitation("member@registration-policy.test");
    const token = invitation.json().token;

    const wrongEmail = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "different@registration-policy.test",
        password: "password-different-123",
        device: device("different-device"),
        inviteToken: token,
      },
    });
    expect(wrongEmail.statusCode).toBe(400);

    const member = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "member@registration-policy.test",
        password: "password-member-123",
        device: device("member-device"),
        inviteToken: token,
      },
    });
    expect(member.statusCode).toBe(200);

    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "another@registration-policy.test",
        password: "password-another-123",
        device: device("another-device"),
        inviteToken: token,
      },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it("rejects an expired invitation", async () => {
    const invitation = await createInvitation("expired@registration-policy.test");
    sql
      .prepare("UPDATE invitations SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), invitation.json().invitation.id);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "expired@registration-policy.test",
        password: "password-expired-123",
        device: device("expired-device"),
        inviteToken: invitation.json().token,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toBe("邀请无效或已过期");
  });

  it("revokes a pending invitation when the admin reissues it", async () => {
    const first = await createInvitation("reissued@registration-policy.test");
    const second = await createInvitation("reissued@registration-policy.test");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const oldToken = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "reissued@registration-policy.test",
        password: "password-old-token-123",
        device: device("old-token-device"),
        inviteToken: first.json().token,
      },
    });
    expect(oldToken.statusCode).toBe(400);

    const newToken = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "reissued@registration-policy.test",
        password: "password-new-token-123",
        device: device("new-token-device"),
        inviteToken: second.json().token,
      },
    });
    expect(newToken.statusCode).toBe(200);
  });

  it("does not let an invited member create invitations", async () => {
    const invitation = await createInvitation("member@registration-policy.test");
    const member = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "member@registration-policy.test",
        password: "password-member-123",
        device: device("member-device"),
        inviteToken: invitation.json().token,
      },
    });
    expect(member.statusCode).toBe(200);

    const memberInvite = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      cookies: { [member.cookies[0].name]: member.cookies[0].value },
      payload: { email: "other@registration-policy.test" },
    });
    expect(memberInvite.statusCode).toBe(403);
  });

  it("validates invitation creation payload", async () => {
    const missingEmail = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      cookies: { [adminCookie.name]: adminCookie.value },
    });
    expect(missingEmail.statusCode).toBe(400);

    const invalidEmail = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { email: 42 },
    });
    expect(invalidEmail.statusCode).toBe(400);

    const invalidExpiry = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      cookies: { [adminCookie.name]: adminCookie.value },
      payload: { email: "other@registration-policy.test", expiresInHours: 721 },
    });
    expect(invalidExpiry.statusCode).toBe(400);
  });

  it("requires authentication to create an invitation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/invitations",
      payload: { email: "other@registration-policy.test" },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("Bootstrap registration", () => {
  it("serializes concurrent first-user registration and creates one admin", async () => {
    const testConfig = makeTestConfig();
    const app = buildApp(testConfig.config);
    await app.ready();

    try {
      const responses = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: {
            email: "first@registration-policy.test",
            password: "password-first-123",
            device: device("first-device"),
          },
        }),
        app.inject({
          method: "POST",
          url: "/api/v1/auth/register",
          payload: {
            email: "second@registration-policy.test",
            password: "password-second-123",
            device: device("second-device"),
          },
        }),
      ]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
      const success = responses.find((response) => response.statusCode === 200);
      expect(success?.json().user.role).toBe("admin");

      const sql = new Database(join(testConfig.config.dataDir, "dashboard.db"));
      try {
        expect(sql.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
        expect(
          sql.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get(),
        ).toEqual({ count: 1 });
      } finally {
        sql.close();
      }
    } finally {
      await app.close();
      testConfig.cleanup();
    }
  });
});

describe("Public registration", () => {
  it("assigns member role after the bootstrap user", async () => {
    const testConfig = makeTestConfig();
    testConfig.config.registrationOpen = true;
    const app = buildApp(testConfig.config);
    await app.ready();

    try {
      const admin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: "admin@public-registration.test",
          password: "password-admin-123",
          device: device("public-admin-device"),
        },
      });
      const member = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          email: "member@public-registration.test",
          password: "password-member-123",
          device: device("public-member-device"),
        },
      });

      expect(admin.statusCode).toBe(200);
      expect(admin.json().user.role).toBe("admin");
      expect(member.statusCode).toBe(200);
      expect(member.json().user.role).toBe("member");
    } finally {
      await app.close();
      testConfig.cleanup();
    }
  });
});

describe("Registration role migration", () => {
  it("promotes the earliest existing user when adding roles", async () => {
    const testConfig = makeTestConfig();
    const sql = new Database(join(testConfig.config.dataDir, "dashboard.db"));
    sql.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email_normalized TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        sync_revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      INSERT INTO users (
        id,
        email_normalized,
        password_hash,
        status,
        sync_revision,
        created_at,
        updated_at
      ) VALUES (
        'usr_existing',
        'existing@registration-policy.test',
        'password-hash-placeholder',
        'active',
        0,
        '2026-08-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z'
      );
    `);
    sql.close();

    const app = buildApp(testConfig.config);
    await app.ready();

    try {
      const migrated = new Database(join(testConfig.config.dataDir, "dashboard.db"));
      try {
        expect(migrated.prepare("SELECT role FROM users WHERE id = ?").get("usr_existing")).toEqual(
          {
            role: "admin",
          },
        );
      } finally {
        migrated.close();
      }
    } finally {
      await app.close();
      testConfig.cleanup();
    }
  });
});
