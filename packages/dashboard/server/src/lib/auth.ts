import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { eq, and, isNull } from "drizzle-orm";
import { unauthorized } from "./http.js";
import { devices, sessions, users } from "../db/schema.js";
import type { Db } from "../db/index.js";

export const SESSION_COOKIE = "paseo_session";
export const ACCESS_TOKEN_HEADER = "authorization";

/** High-entropy opaque token (64 hex chars = 32 bytes). */
export function newToken(byteLen = 32): string {
  return randomBytes(byteLen).toString("hex");
}

/** SHA-256 hash for token storage; not reversible to the raw token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge,
  };
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  deviceId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Extract access token from Cookie or Authorization: Bearer header. */
export function accessTokenFrom(req: FastifyRequest): string | null {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;
  const h = req.headers[ACCESS_TOKEN_HEADER];
  if (typeof h === "string" && h.startsWith("Bearer ")) return h.slice(7);
  return null;
}

/** Extract refresh token from request body, Cookie, or Bearer header. */
export function refreshTokenFrom(req: FastifyRequest): string | null {
  const body = req.body as { refreshToken?: string } | null;
  if (body?.refreshToken) return body.refreshToken;
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;
  const h = req.headers[ACCESS_TOKEN_HEADER];
  if (typeof h === "string" && h.startsWith("Bearer ")) return h.slice(7);
  return null;
}

/** A session is usable only while its account and owning device remain active. */
export async function isSessionPrincipalActive(
  db: Db,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const rows = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(
      devices,
      and(eq(devices.id, deviceId), eq(devices.userId, users.id), isNull(devices.revokedAt)),
    )
    .where(and(eq(users.id, userId), eq(users.status, "active"), isNull(users.deletedAt)))
    .limit(1);

  return rows.length > 0;
}

/**
 * Resolve a session by access token hash. Used for auth-protected endpoints
 * (hosts, sync, me). Only matches an active account/device and an unrevoked,
 * unexpired session.
 */
export function requireAuth(db: Db) {
  return async function preHandler(req: FastifyRequest, rep: FastifyReply) {
    const token = accessTokenFrom(req);
    if (!token) return unauthorized(rep, "缺少登录凭证");

    const hash = hashToken(token);
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.accessTokenHash, hash), isNull(sessions.revokedAt)))
      .limit(1);

    if (rows.length === 0) return unauthorized(rep, "会话不存在或已撤销");

    const session = rows[0];
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return unauthorized(rep, "会话已过期");
    }
    if (!(await isSessionPrincipalActive(db, session.userId, session.deviceId))) {
      return unauthorized(rep, "账户或设备不可用");
    }

    req.auth = {
      sessionId: session.id,
      userId: session.userId,
      deviceId: session.deviceId,
    };
    return undefined;
  };
}

/**
 * Revoke all sessions in a token family. Called when refresh token reuse is
 * detected — an attacker may have stolen a refresh token, so we burn the
 * entire chain to force re-authentication.
 */
export async function revokeFamily(db: Db, familyId: string, now: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
}
