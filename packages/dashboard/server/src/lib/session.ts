import type { FastifyReply, FastifyRequest } from "fastify";
import { newId } from "./id.js";
import { cookieOptions, hashToken, newToken, SESSION_COOKIE } from "./auth.js";
import { requestEnvironment } from "./session-environment.js";
import { sessions } from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { ServerConfig } from "../config.js";
import type { AuthMethod } from "@getpaseo/dashboard-shared";

export async function issueSession(
  db: Db,
  config: ServerConfig,
  userId: string,
  deviceId: string,
  authMethod: AuthMethod,
  req: FastifyRequest,
  rep: FastifyReply,
) {
  const accessToken = newToken();
  const refreshToken = newToken(config.refreshTokenBytes);
  const familyId = newId("fam");
  const sessionId = newId("ses");
  const now = new Date().toISOString();
  const environment = requestEnvironment(req);

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    deviceId,
    accessTokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    familyId,
    rotationCounter: 0,
    createdAt: now,
    expiresAt: new Date(Date.now() + config.accessTokenTtl * 1000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000).toISOString(),
    lastUsedAt: now,
    ipPrefix: environment.ipPrefix,
    userAgentSummary: environment.userAgentSummary,
    authMethod,
  });

  rep.setCookie(SESSION_COOKIE, accessToken, cookieOptions(config.accessTokenTtl));
  rep.header("Cache-Control", "no-store");

  return { accessToken, refreshToken, sessionId, environment };
}
