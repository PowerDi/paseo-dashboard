import type { UserRole } from "@getpaseo/dashboard-shared";
import type { FastifyInstance } from "fastify";
import { eq, and, gt, isNull } from "drizzle-orm";
import argon2 from "argon2";
import { newId } from "../lib/id.js";
import {
  hashToken,
  newToken,
  cookieOptions,
  accessTokenFrom,
  refreshTokenFrom,
  isSessionPrincipalActive,
  requireAuth,
  revokeFamily,
  SESSION_COOKIE,
} from "../lib/auth.js";
import { badRequest, unauthorized, notFound } from "../lib/http.js";
import { users, devices, sessions, invitations, auditEvents } from "../db/schema.js";
import { truncateIp } from "../app.js";
import type { Db } from "../db/index.js";
import type { ServerConfig } from "../config.js";

class EmailAlreadyRegisteredError extends Error {}
class InvitationUnavailableError extends Error {}
class RegistrationClosedError extends Error {}

type RegistrationMethod = "bootstrap" | "invitation" | "public";

export function registerAuthRoutes(app: FastifyInstance, db: Db, config: ServerConfig) {
  const auth = requireAuth(db);

  function setAccessCookie(rep: import("fastify").FastifyReply, token: string) {
    rep.setCookie(SESSION_COOKIE, token, cookieOptions(config.accessTokenTtl));
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  function accessExpiry(): string {
    return new Date(Date.now() + config.accessTokenTtl * 1000).toISOString();
  }

  function refreshExpiry(): string {
    return new Date(Date.now() + config.refreshTokenTtl * 1000).toISOString();
  }

  async function createSession(
    userId: string,
    deviceId: string,
    req: import("fastify").FastifyRequest,
    rep: import("fastify").FastifyReply,
  ) {
    const accessToken = newToken();
    const refreshToken = newToken(config.refreshTokenBytes);
    const familyId = newId("fam");
    const sessionId = newId("ses");
    const now = nowIso();

    await db.insert(sessions).values({
      id: sessionId,
      userId,
      deviceId,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      familyId,
      rotationCounter: 0,
      createdAt: now,
      expiresAt: accessExpiry(),
      refreshExpiresAt: refreshExpiry(),
      lastUsedAt: now,
      ipPrefix: truncateIp(req.ip),
    });

    setAccessCookie(rep, accessToken);
    rep.header("Cache-Control", "no-store");

    return { accessToken, refreshToken, sessionId };
  }

  // ── POST /api/v1/auth/register ──────────────────────
  app.post("/api/v1/auth/register", async (req, rep) => {
    const { email, password, device, inviteToken } = req.body as {
      email: string;
      password: string;
      device: { installationId: string; name: string; platform: string };
      inviteToken?: string;
    };

    if (!email || !password || !device?.installationId) {
      return badRequest(rep, "email、password 和 device.installationId 为必填");
    }
    if (password.length < 8) {
      return badRequest(rep, "密码长度至少 8 位");
    }

    const normalized = email.toLowerCase().trim();
    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.emailNormalized, normalized), isNull(users.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      return badRequest(rep, "该邮箱已被注册", { code: "email_exists" });
    }

    const now = nowIso();
    let invitationId: string | null = null;

    if (inviteToken !== undefined) {
      if (typeof inviteToken !== "string" || !/^[a-f0-9]{64}$/.test(inviteToken)) {
        return badRequest(rep, "邀请无效或已过期");
      }
      const invitationRows = await db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.tokenHash, hashToken(inviteToken)),
            eq(invitations.emailNormalized, normalized),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, now),
          ),
        )
        .limit(1);
      if (invitationRows.length === 0) return badRequest(rep, "邀请无效或已过期");
      invitationId = invitationRows[0].id;
    } else if (!config.registrationOpen) {
      const existingUser = await db
        .select({ id: users.id })
        .from(users)
        .where(isNull(users.deletedAt))
        .limit(1);
      if (existingUser.length > 0) return badRequest(rep, "注册已关闭");
    }

    const userId = newId("usr");
    const deviceId = newId("dev");
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: config.argon2MemoryCost,
      timeCost: config.argon2TimeCost,
      parallelism: config.argon2Parallelism,
    });

    let role: UserRole;
    try {
      role = db.transaction(
        (tx): UserRole => {
          const existingUser = tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.emailNormalized, normalized), isNull(users.deletedAt)))
            .limit(1)
            .get();
          if (existingUser) throw new EmailAlreadyRegisteredError();

          const hasUsers = Boolean(
            tx.select({ id: users.id }).from(users).where(isNull(users.deletedAt)).limit(1).get(),
          );
          if (!invitationId && hasUsers && !config.registrationOpen) {
            throw new RegistrationClosedError();
          }

          if (invitationId) {
            const consumed = tx
              .update(invitations)
              .set({ acceptedAt: now })
              .where(
                and(
                  eq(invitations.id, invitationId),
                  eq(invitations.emailNormalized, normalized),
                  isNull(invitations.acceptedAt),
                  isNull(invitations.revokedAt),
                  gt(invitations.expiresAt, now),
                ),
              )
              .run();
            if (consumed.changes !== 1) throw new InvitationUnavailableError();
          }

          const assignedRole: UserRole = hasUsers ? "member" : "admin";
          tx.insert(users)
            .values({
              id: userId,
              emailNormalized: normalized,
              passwordHash,
              role: assignedRole,
              status: "active",
              syncRevision: 0,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          tx.insert(devices)
            .values({
              id: deviceId,
              userId,
              installationIdHash: hashToken(device.installationId),
              displayName: device.name || "未知设备",
              platform: device.platform || "unknown",
              firstSeenAt: now,
              lastSeenAt: now,
            })
            .run();
          let registration: RegistrationMethod = "public";
          if (invitationId) registration = "invitation";
          else if (assignedRole === "admin") registration = "bootstrap";

          tx.insert(auditEvents)
            .values({
              id: newId("aud"),
              userId,
              type: "user.registered",
              targetType: "user",
              targetId: userId,
              metadata: JSON.stringify({
                registration,
                ...(invitationId ? { invitationId } : {}),
              }),
              createdAt: now,
            })
            .run();
          return assignedRole;
        },
        { behavior: "immediate" },
      );
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        return badRequest(rep, "该邮箱已被注册", { code: "email_exists" });
      }
      if (error instanceof InvitationUnavailableError) {
        return badRequest(rep, "邀请无效或已过期");
      }
      if (error instanceof RegistrationClosedError) {
        return badRequest(rep, "注册已关闭");
      }
      throw error;
    }

    const { accessToken, refreshToken } = await createSession(userId, deviceId, req, rep);

    return {
      user: { id: userId, email: normalized, role },
      deviceId,
      accessToken,
      refreshToken,
      expiresIn: config.accessTokenTtl,
    };
  });

  // ── POST /api/v1/auth/login ─────────────────────────
  app.post("/api/v1/auth/login", async (req, rep) => {
    const { email, password, device } = req.body as {
      email: string;
      password: string;
      device: { installationId: string; name: string; platform: string };
    };

    if (!email || !password || !device?.installationId) {
      return badRequest(rep, "email、password 和 device.installationId 为必填");
    }

    const normalized = email.toLowerCase().trim();
    const userRows = await db
      .select()
      .from(users)
      .where(and(eq(users.emailNormalized, normalized), isNull(users.deletedAt)))
      .limit(1);

    // Same error for wrong email and wrong password — no account enumeration
    if (userRows.length === 0) {
      await db.insert(auditEvents).values({
        id: newId("aud"),
        userId: "",
        type: "user.login_failed",
        targetType: "auth",
        targetId: "",
        metadata: JSON.stringify({ reason: "user_not_found" }),
        createdAt: new Date().toISOString(),
      });
      return unauthorized(rep, "邮箱或密码错误");
    }

    const user = userRows[0];
    if (user.status !== "active") {
      return unauthorized(rep, "邮箱或密码错误");
    }

    const now = nowIso();
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      await db.insert(auditEvents).values({
        id: newId("aud"),
        userId: user.id,
        type: "user.login_failed",
        targetType: "user",
        targetId: user.id,
        metadata: JSON.stringify({ reason: "wrong_password" }),
        createdAt: now,
      });
      return unauthorized(rep, "邮箱或密码错误");
    }

    const instHash = hashToken(device.installationId);

    // Create or update device
    const existingDevices = await db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.userId, user.id),
          eq(devices.installationIdHash, instHash),
          isNull(devices.revokedAt),
        ),
      )
      .limit(1);

    let deviceId: string;
    if (existingDevices.length > 0) {
      deviceId = existingDevices[0].id;
      await db
        .update(devices)
        .set({ lastSeenAt: now, displayName: device.name || existingDevices[0].displayName })
        .where(eq(devices.id, deviceId));
    } else {
      deviceId = newId("dev");
      await db.insert(devices).values({
        id: deviceId,
        userId: user.id,
        installationIdHash: instHash,
        displayName: device.name || "未知设备",
        platform: device.platform || "unknown",
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }

    const { accessToken, refreshToken } = await createSession(user.id, deviceId, req, rep);

    await db.insert(auditEvents).values({
      id: newId("aud"),
      userId: user.id,
      type: "user.login",
      targetType: "user",
      targetId: user.id,
      metadata: JSON.stringify({}),
      createdAt: now,
    });

    return {
      user: { id: user.id, email: normalized, role: user.role },
      deviceId,
      accessToken,
      refreshToken,
      expiresIn: config.accessTokenTtl,
    };
  });

  // ── POST /api/v1/auth/refresh ───────────────────────
  app.post("/api/v1/auth/refresh", async (req, rep) => {
    const refreshToken = refreshTokenFrom(req);
    if (!refreshToken) return unauthorized(rep, "缺少 refresh token");

    const hash = hashToken(refreshToken);

    // Look for a session with this refresh token hash (including revoked ones)
    const allMatches = await db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hash))
      .limit(1);

    if (allMatches.length === 0) {
      return unauthorized(rep, "refresh token 无效");
    }

    const matched = allMatches[0];
    const now = nowIso();

    // Reuse detection: if the matched session is already revoked, someone is
    // replaying an old refresh token. Revoke the entire family.
    if (matched.revokedAt !== null) {
      await revokeFamily(db, matched.familyId, now);
      return unauthorized(rep, "refresh token 已失效");
    }

    if (!(await isSessionPrincipalActive(db, matched.userId, matched.deviceId))) {
      await revokeFamily(db, matched.familyId, now);
      return unauthorized(rep, "账户或设备不可用");
    }

    // Check refresh token expiry
    if (new Date(matched.refreshExpiresAt).getTime() < Date.now()) {
      await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, matched.id));
      return unauthorized(rep, "refresh token 已过期");
    }

    // Rotate: revoke old session, create new session in same family
    const newAccess = newToken();
    const newRefresh = newToken(config.refreshTokenBytes);
    const newCounter = matched.rotationCounter + 1;

    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, matched.id));

    const newSessionId = newId("ses");
    await db.insert(sessions).values({
      id: newSessionId,
      userId: matched.userId,
      deviceId: matched.deviceId,
      accessTokenHash: hashToken(newAccess),
      refreshTokenHash: hashToken(newRefresh),
      familyId: matched.familyId,
      rotationCounter: newCounter,
      createdAt: now,
      expiresAt: accessExpiry(),
      refreshExpiresAt: refreshExpiry(),
      lastUsedAt: now,
      ipPrefix: truncateIp(req.ip),
    });

    setAccessCookie(rep, newAccess);
    rep.header("Cache-Control", "no-store");

    return {
      accessToken: newAccess,
      refreshToken: newRefresh,
      expiresIn: config.accessTokenTtl,
    };
  });

  // ── POST /api/v1/auth/logout ───────────────────────
  app.post("/api/v1/auth/logout", async (req, rep) => {
    const token = accessTokenFrom(req);
    if (token) {
      const hash = hashToken(token);
      const sessRows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.accessTokenHash, hash), isNull(sessions.revokedAt)))
        .limit(1);
      if (sessRows.length > 0) {
        const now = nowIso();
        await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, sessRows[0].id));
        await db.insert(auditEvents).values({
          id: newId("aud"),
          userId: sessRows[0].userId,
          type: "user.logout",
          targetType: "user",
          targetId: sessRows[0].userId,
          metadata: JSON.stringify({}),
          createdAt: now,
        });
      }
    }
    rep.clearCookie(SESSION_COOKIE, { path: "/" });
    rep.header("Cache-Control", "no-store");
    return { ok: true };
  });

  // ── POST /api/v1/auth/change-password ──────────────
  app.post("/api/v1/auth/change-password", { preHandler: auth }, async (req, rep) => {
    const { currentPassword, newPassword, revokeOtherSessions } = req.body as {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions: boolean;
    };

    if (!currentPassword || !newPassword) {
      return badRequest(rep, "currentPassword 和 newPassword 为必填");
    }
    if (newPassword.length < 8) {
      return badRequest(rep, "新密码长度至少 8 位");
    }

    const userRows = await db.select().from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (userRows.length === 0) return notFound(rep, "用户不存在");

    const user = userRows[0];
    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) {
      return unauthorized(rep, "当前密码错误");
    }

    const newHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: config.argon2MemoryCost,
      timeCost: config.argon2TimeCost,
      parallelism: config.argon2Parallelism,
    });
    const now = nowIso();

    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: now })
      .where(eq(users.id, user.id));

    // Revoke other sessions if requested
    if (revokeOtherSessions) {
      await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    }

    // Always rotate current session's refresh token
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, req.auth!.sessionId));

    // Issue new session for current device
    const { accessToken, refreshToken } = await createSession(
      user.id,
      req.auth!.deviceId,
      req,
      rep,
    );

    await db.insert(auditEvents).values({
      id: newId("aud"),
      userId: user.id,
      type: "user.password_changed",
      targetType: "user",
      targetId: user.id,
      metadata: JSON.stringify({ revokeOtherSessions }),
      createdAt: now,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: config.accessTokenTtl,
    };
  });

  // ── GET /api/v1/me ─────────────────────────────────
  app.get("/api/v1/me", { preHandler: auth }, async (req, rep) => {
    const userRows = await db.select().from(users).where(eq(users.id, req.auth!.userId)).limit(1);
    if (userRows.length === 0) return notFound(rep, "用户不存在");
    rep.header("Cache-Control", "no-store");
    return {
      user: {
        id: userRows[0].id,
        email: userRows[0].emailNormalized,
        role: userRows[0].role,
      },
    };
  });
}
