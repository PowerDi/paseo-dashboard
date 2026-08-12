import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildApp } from "@getpaseo/dashboard-server/app";
import type { ServerConfig } from "@getpaseo/dashboard-server/config";

function makeTestConfig(overrides?: Partial<ServerConfig>): {
  config: ServerConfig;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "paseo-board-test-"));
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
    argon2MemoryCost: 1024, // low for tests
    argon2TimeCost: 1,
    argon2Parallelism: 1,
    registrationOpen: true,
    trustedProxies: [],
    ...overrides,
  };

  return {
    config,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeDevice(
  overrides?: Partial<{ installationId: string; name: string; platform: string }>,
) {
  return {
    installationId: overrides?.installationId || "test-dev-001",
    name: overrides?.name || "Test Device",
    platform: overrides?.platform || "web",
  };
}

describe("Auth API contract", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;

  beforeAll(async () => {
    const cfg = makeTestConfig();
    cleanup = cfg.cleanup;
    app = buildApp(cfg.config);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("POST /api/v1/auth/register — creates user and returns session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice(),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe("alice@example.com");
    expect(body.deviceId).toBeTruthy();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.accessToken).not.toBe(body.refreshToken);
    expect(body.expiresIn).toBe(900);
    expect(res.headers["cache-control"]).toBe("no-store");
    const cookies = res.cookies;
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies[0].name).toBe("paseo_session");
    expect(cookies[0].httpOnly).toBe(true);
  });

  it("POST /api/v1/auth/register — rejects duplicate email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "alice@example.com",
        password: "another-pass-456",
        device: makeDevice({ installationId: "test-dev-002" }),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("POST /api/v1/auth/register — rejects short password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "bob@example.com",
        password: "1234567",
        device: makeDevice({ installationId: "test-dev-003" }),
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/v1/auth/login — succeeds with valid credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice({ installationId: "test-dev-004" }),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe("alice@example.com");
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.accessToken).not.toBe(body.refreshToken);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("POST /api/v1/auth/login — rejects wrong password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "wrong-password",
        device: makeDevice({ installationId: "test-dev-005" }),
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST /api/v1/auth/login — rejects non-existent email with same error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "nobody@example.com",
        password: "wrong-password",
        device: makeDevice({ installationId: "test-dev-nonexistent" }),
      },
    });

    expect(res.statusCode).toBe(401);
    // Same error message as wrong password — no account enumeration
    expect(res.json().error.message).toBe("邮箱或密码错误");
  });

  it("GET /api/v1/me — returns user when authenticated", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice({ installationId: "test-dev-006" }),
      },
    });

    const cookie = loginRes.cookies[0];
    expect(cookie).toBeDefined();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { [cookie.name]: cookie.value },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe("alice@example.com");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("GET /api/v1/me — rejects unauthenticated requests", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/me",
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST /api/v1/auth/refresh — rotates tokens and invalidates old refresh", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice({ installationId: "test-dev-007" }),
      },
    });

    const body = loginRes.json();
    const oldRefresh = body.refreshToken;
    const oldAccess = loginRes.cookies[0].value;

    // Refresh using the refresh token in body
    const refreshRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: oldRefresh },
    });

    expect(refreshRes.statusCode).toBe(200);
    const refreshBody = refreshRes.json();
    expect(refreshBody.accessToken).toBeTruthy();
    expect(refreshBody.refreshToken).toBeTruthy();
    expect(refreshBody.accessToken).not.toBe(oldAccess);
    expect(refreshBody.refreshToken).not.toBe(oldRefresh);

    // Old access token should no longer work (session revoked)
    const oldRes = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { [loginRes.cookies[0].name]: oldAccess },
    });
    expect(oldRes.statusCode).toBe(401);
  });

  it("POST /api/v1/auth/refresh — reuse detection revokes entire family", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice({ installationId: "test-dev-reuse" }),
      },
    });

    const oldRefresh = loginRes.json().refreshToken;

    // First refresh — legitimate rotation
    const refresh1 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: oldRefresh },
    });
    expect(refresh1.statusCode).toBe(200);
    const newRefresh = refresh1.json().refreshToken;
    const newAccess = refresh1.cookies[0].value;

    // Replay old refresh token — should trigger family revocation
    const refresh2 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: oldRefresh },
    });
    expect(refresh2.statusCode).toBe(401);

    // New refresh token (from refresh1) should now be revoked too
    const refresh3 = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: newRefresh },
    });
    expect(refresh3.statusCode).toBe(401);

    // Access token from refresh1 should be dead
    const meRes = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { [refresh1.cookies[0].name]: newAccess },
    });
    expect(meRes.statusCode).toBe(401);
  });

  it("POST /api/v1/auth/refresh — rejects invalid refresh token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      payload: { refreshToken: "invalid-token-hex" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("POST /api/v1/auth/logout — revokes session", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice({ installationId: "test-dev-008" }),
      },
    });

    const cookie = loginRes.cookies[0];
    const token = cookie.value;

    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    const meRes = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.statusCode).toBe(401);
  });

  it("POST /api/v1/auth/change-password — rotates token and revokes others", async () => {
    // Login on device A
    const loginA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice({ installationId: "test-dev-chgpw-a" }),
      },
    });

    // Login on device B
    const loginB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice({ installationId: "test-dev-chgpw-b" }),
      },
    });

    const accessA = loginA.cookies[0].value;
    const accessB = loginB.cookies[0].value;

    // Change password from device A, revoke others
    const changeRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      cookies: { [loginA.cookies[0].name]: accessA },
      payload: {
        currentPassword: "secure-pass-123",
        newPassword: "new-secure-pass-456",
        revokeOtherSessions: true,
      },
    });

    expect(changeRes.statusCode).toBe(200);
    const body = changeRes.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();

    // Device B access should be revoked
    const meB = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { [loginB.cookies[0].name]: accessB },
    });
    expect(meB.statusCode).toBe(401);

    // Old password should fail
    const loginOld = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "secure-pass-123",
        device: makeDevice({ installationId: "test-dev-chgpw-old" }),
      },
    });
    expect(loginOld.statusCode).toBe(401);

    // New password should work
    const loginNew = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "new-secure-pass-456",
        device: makeDevice({ installationId: "test-dev-chgpw-new" }),
      },
    });
    expect(loginNew.statusCode).toBe(200);
  });

  it("POST /api/v1/auth/change-password — rejects wrong current password", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "alice@example.com",
        password: "new-secure-pass-456",
        device: makeDevice({ installationId: "test-dev-chgpw-wrong" }),
      },
    });

    const changeRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/change-password",
      cookies: { [loginRes.cookies[0].name]: loginRes.cookies[0].value },
      payload: {
        currentPassword: "wrong-current",
        newPassword: "another-new-pass-789",
        revokeOtherSessions: false,
      },
    });

    expect(changeRes.statusCode).toBe(401);
  });
});

// ── Registration closure tests ──────────────────────────

describe("Registration closure", () => {
  let app: ReturnType<typeof buildApp>;
  let cleanup: () => void;

  beforeAll(async () => {
    const cfg = makeTestConfig({ registrationOpen: false });
    cleanup = cfg.cleanup;
    app = buildApp(cfg.config);
    await app.ready();

    // Manually insert a user so registrationOpen=false triggers the gate
    // (gate fires when users exist AND registrationOpen is false)
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "first@example.com",
        password: "first-pass-123",
        device: makeDevice({ installationId: "first-dev" }),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("rejects new registration when closed and user exists", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "second@example.com",
        password: "second-pass-123",
        device: makeDevice({ installationId: "second-dev" }),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe("注册已关闭");
  });

  it("allows login when registration is closed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: "first@example.com",
        password: "first-pass-123",
        device: makeDevice({ installationId: "login-dev" }),
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
