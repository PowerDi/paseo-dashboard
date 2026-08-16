import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import argon2 from "argon2";
import { auditEvents, devices, passkeys, users, webauthnChallenges } from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { ServerConfig } from "../config.js";
import { hashToken, requireAuth } from "../lib/auth.js";
import { newId } from "../lib/id.js";
import { badRequest, conflict, notFound, unauthorized } from "../lib/http.js";
import { issueSession } from "../lib/session.js";
import { requestEnvironment } from "../lib/session-environment.js";
import type { DeviceInfo, Passkey } from "@getpaseo/dashboard-shared";

const CEREMONY_TTL_MS = 5 * 60_000;
const PASSKEY_NAME_MAX_LENGTH = 80;

function webauthnConfig(config: ServerConfig) {
  const origin =
    config.webauthnOrigin ??
    (config.corsOrigin === "*" ? "http://localhost:5173" : config.corsOrigin);
  let rpId = config.webauthnRpId;
  if (!rpId) {
    try {
      rpId = new URL(origin).hostname;
    } catch {
      rpId = "localhost";
    }
  }
  return {
    origin,
    rpId,
    rpName: config.webauthnRpName ?? "Paseo Dashboard",
  };
}

function expiryIso(): string {
  return new Date(Date.now() + CEREMONY_TTL_MS).toISOString();
}

function transportsFrom(value: string): AuthenticatorTransportFuture[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AuthenticatorTransportFuture => typeof item === "string");
  } catch {
    return [];
  }
}

function passkeyName(input: unknown): string {
  if (typeof input !== "string") return "Passkey";
  const trimmed = input.trim();
  return trimmed ? trimmed.slice(0, PASSKEY_NAME_MAX_LENGTH) : "Passkey";
}

function responseObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function challengeMatches(expectedHash: string) {
  return (challenge: string) => hashToken(challenge) === expectedHash;
}

function userHandleFor(userId: string): string {
  return Buffer.from(userId, "utf8").toString("base64url");
}

async function recordLoginFailure(
  db: Db,
  req: FastifyRequest,
  userId: string,
  reason: string,
): Promise<void> {
  const environment = requestEnvironment(req);
  await db.insert(auditEvents).values({
    id: newId("aud"),
    userId,
    type: "user.login_failed",
    targetType: userId ? "user" : "auth",
    targetId: userId,
    metadata: JSON.stringify({
      reason,
      authMethod: "passkey",
      ipPrefix: environment.ipPrefix,
      userAgentSummary: environment.userAgentSummary,
    }),
    createdAt: new Date().toISOString(),
  });
}

interface PasskeyLoginInput {
  ceremonyId: string;
  response: AuthenticationResponseJSON;
  device: DeviceInfo;
}

function parseDeviceInfo(value: unknown): DeviceInfo | null {
  const device = responseObject(value);
  if (typeof device?.installationId !== "string" || !device.installationId) return null;
  const platform =
    device.platform === "web" || device.platform === "harmony" ? device.platform : "unknown";
  return {
    installationId: device.installationId,
    name: typeof device.name === "string" ? device.name : "",
    platform,
  };
}

function parsePasskeyLoginInput(value: unknown): PasskeyLoginInput | null {
  const body = responseObject(value);
  const credential = responseObject(body?.response);
  if (
    typeof body?.ceremonyId !== "string" ||
    typeof credential?.id !== "string" ||
    !responseObject(credential.response)
  ) {
    return null;
  }
  const device = parseDeviceInfo(body.device);
  if (!device) return null;
  return {
    ceremonyId: body.ceremonyId,
    response: credential as unknown as AuthenticationResponseJSON,
    device,
  };
}

async function verifyStoredPasskey(
  db: Db,
  req: FastifyRequest,
  user: typeof users.$inferSelect,
  passkey: typeof passkeys.$inferSelect,
  response: AuthenticationResponseJSON,
  challengeHash: string,
  relyingParty: ReturnType<typeof webauthnConfig>,
): Promise<VerifiedAuthenticationResponse | null> {
  if (response.response.userHandle && response.response.userHandle !== userHandleFor(user.id)) {
    await recordLoginFailure(db, req, user.id, "user_handle_mismatch");
    return null;
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeMatches(challengeHash),
      expectedOrigin: relyingParty.origin,
      expectedRPID: relyingParty.rpId,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKeyB64, "base64")),
        counter: passkey.counter,
        transports: transportsFrom(passkey.transports),
      },
      requireUserVerification: true,
    });
    if (verification.verified) return verification;
  } catch {
    // The audit reason stays generic so response details do not reach logs or storage.
  }

  await recordLoginFailure(db, req, user.id, "assertion_invalid");
  return null;
}

async function upsertPasskeyDevice(
  db: Db,
  userId: string,
  device: DeviceInfo,
  environment: ReturnType<typeof requestEnvironment>,
  now: string,
): Promise<{ deviceId: string; newDevice: boolean }> {
  const installationIdHash = hashToken(device.installationId);
  const existingDevice = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.userId, userId),
        eq(devices.installationIdHash, installationIdHash),
        isNull(devices.revokedAt),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (existingDevice) {
    await db
      .update(devices)
      .set({
        displayName: device.name || existingDevice.displayName,
        platform: device.platform || existingDevice.platform,
        lastSeenAt: now,
        lastIpPrefix: environment.ipPrefix,
        lastUserAgentSummary: environment.userAgentSummary,
        lastAuthMethod: "passkey",
      })
      .where(eq(devices.id, existingDevice.id));
    return { deviceId: existingDevice.id, newDevice: false };
  }

  const deviceId = newId("dev");
  await db.insert(devices).values({
    id: deviceId,
    userId,
    installationIdHash,
    displayName: device.name || "未知设备",
    platform: device.platform || "unknown",
    firstSeenAt: now,
    lastSeenAt: now,
    lastIpPrefix: environment.ipPrefix,
    lastUserAgentSummary: environment.userAgentSummary,
    lastAuthMethod: "passkey",
  });
  return { deviceId, newDevice: true };
}

export function registerPasskeyRoutes(app: FastifyInstance, db: Db, config: ServerConfig) {
  const auth = requireAuth(db);
  const relyingParty = webauthnConfig(config);

  app.get("/api/v1/passkeys", { preHandler: auth }, async (req, rep) => {
    const rows = await db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, req.auth!.userId))
      .orderBy(desc(passkeys.createdAt));
    const result: Passkey[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      deviceType: row.deviceType,
      backedUp: row.backedUp,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    }));
    rep.header("Cache-Control", "no-store");
    return result;
  });

  app.post("/api/v1/passkeys/registration/options", { preHandler: auth }, async (req, rep) => {
    const body = responseObject(req.body);
    const currentPassword = body?.currentPassword;
    if (typeof currentPassword !== "string" || !currentPassword) {
      return badRequest(rep, "currentPassword 为必填");
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, req.auth!.userId))
      .limit(1)
      .then((rows) => rows[0]);
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) {
      return unauthorized(rep, "当前密码错误");
    }

    const existing = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    const options = await generateRegistrationOptions({
      rpName: relyingParty.rpName,
      rpID: relyingParty.rpId,
      userID: new TextEncoder().encode(user.id),
      userName: user.emailNormalized,
      userDisplayName: user.emailNormalized,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: transportsFrom(credential.transports),
      })),
      supportedAlgorithmIDs: [-7, -257],
    });

    const now = new Date().toISOString();
    await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, now));
    const ceremonyId = newId("wac");
    await db.insert(webauthnChallenges).values({
      id: ceremonyId,
      purpose: "registration",
      userId: user.id,
      sessionId: req.auth!.sessionId,
      challengeHash: hashToken(options.challenge),
      createdAt: now,
      expiresAt: expiryIso(),
    });

    rep.header("Cache-Control", "no-store");
    return { ceremonyId, options };
  });

  app.post("/api/v1/passkeys/registration/verify", { preHandler: auth }, async (req, rep) => {
    const body = responseObject(req.body);
    const ceremonyId = body?.ceremonyId;
    const response = body?.response;
    if (typeof ceremonyId !== "string" || !responseObject(response)) {
      return badRequest(rep, "ceremonyId 和 response 为必填");
    }

    const now = new Date().toISOString();
    const challenge = await db
      .select()
      .from(webauthnChallenges)
      .where(
        and(
          eq(webauthnChallenges.id, ceremonyId),
          eq(webauthnChallenges.purpose, "registration"),
          eq(webauthnChallenges.userId, req.auth!.userId),
          eq(webauthnChallenges.sessionId, req.auth!.sessionId),
          isNull(webauthnChallenges.usedAt),
          gt(webauthnChallenges.expiresAt, now),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    if (!challenge) return badRequest(rep, "Passkey 注册请求无效或已过期");

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge: challengeMatches(challenge.challengeHash),
        expectedOrigin: relyingParty.origin,
        expectedRPID: relyingParty.rpId,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch {
      return badRequest(rep, "Passkey 注册验证失败");
    }
    if (!verification.verified) return badRequest(rep, "Passkey 注册验证失败");

    const credential = verification.registrationInfo.credential;
    const passkeyId = newId("psk");
    try {
      db.transaction((tx) => {
        const claimed = tx
          .update(webauthnChallenges)
          .set({ usedAt: now })
          .where(
            and(
              eq(webauthnChallenges.id, ceremonyId),
              isNull(webauthnChallenges.usedAt),
              gt(webauthnChallenges.expiresAt, now),
            ),
          )
          .run();
        if (claimed.changes !== 1) throw new Error("ceremony_already_used");

        tx.insert(passkeys)
          .values({
            id: passkeyId,
            userId: req.auth!.userId,
            credentialId: credential.id,
            publicKeyB64: Buffer.from(credential.publicKey).toString("base64"),
            counter: credential.counter,
            transports: JSON.stringify(credential.transports ?? []),
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp,
            name: passkeyName(body?.name),
            createdAt: now,
          })
          .run();

        tx.insert(auditEvents)
          .values({
            id: newId("aud"),
            userId: req.auth!.userId,
            deviceId: req.auth!.deviceId,
            sessionId: req.auth!.sessionId,
            type: "passkey.registered",
            targetType: "passkey",
            targetId: passkeyId,
            metadata: JSON.stringify({
              deviceType: verification.registrationInfo.credentialDeviceType,
              backedUp: verification.registrationInfo.credentialBackedUp,
            }),
            createdAt: now,
          })
          .run();
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        return conflict(rep, "passkey_exists", "该 Passkey 已注册");
      }
      if (error instanceof Error && error.message === "ceremony_already_used") {
        return badRequest(rep, "Passkey 注册请求已使用");
      }
      throw error;
    }

    rep.header("Cache-Control", "no-store");
    return {
      passkey: {
        id: passkeyId,
        name: passkeyName(body?.name),
        deviceType: verification.registrationInfo.credentialDeviceType,
        backedUp: verification.registrationInfo.credentialBackedUp,
        createdAt: now,
        lastUsedAt: null,
      } satisfies Passkey,
    };
  });

  app.delete("/api/v1/passkeys/:id", { preHandler: auth }, async (req, rep) => {
    const { id } = req.params as { id: string };
    const existing = await db
      .select()
      .from(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, req.auth!.userId)))
      .limit(1)
      .then((rows) => rows[0]);
    if (!existing) return notFound(rep, "Passkey 不存在");

    const now = new Date().toISOString();
    db.transaction((tx) => {
      tx.delete(passkeys)
        .where(and(eq(passkeys.id, id), eq(passkeys.userId, req.auth!.userId)))
        .run();
      tx.insert(auditEvents)
        .values({
          id: newId("aud"),
          userId: req.auth!.userId,
          deviceId: req.auth!.deviceId,
          sessionId: req.auth!.sessionId,
          type: "passkey.deleted",
          targetType: "passkey",
          targetId: id,
          metadata: JSON.stringify({}),
          createdAt: now,
        })
        .run();
    });
    rep.header("Cache-Control", "no-store");
    return { ok: true };
  });

  app.post("/api/v1/auth/passkey/login/options", async (_req, rep) => {
    const options = await generateAuthenticationOptions({
      rpID: relyingParty.rpId,
      userVerification: "required",
    });
    const now = new Date().toISOString();
    await db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, now));
    const ceremonyId = newId("wac");
    await db.insert(webauthnChallenges).values({
      id: ceremonyId,
      purpose: "authentication",
      challengeHash: hashToken(options.challenge),
      createdAt: now,
      expiresAt: expiryIso(),
    });
    rep.header("Cache-Control", "no-store");
    return { ceremonyId, options };
  });

  app.post("/api/v1/auth/passkey/login/verify", async (req, rep) => {
    const input = parsePasskeyLoginInput(req.body);
    if (!input) {
      return badRequest(rep, "ceremonyId、response 和 device.installationId 为必填");
    }

    const now = new Date().toISOString();
    const challenge = await db
      .select()
      .from(webauthnChallenges)
      .where(
        and(
          eq(webauthnChallenges.id, input.ceremonyId),
          eq(webauthnChallenges.purpose, "authentication"),
          isNull(webauthnChallenges.usedAt),
          gt(webauthnChallenges.expiresAt, now),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);
    if (!challenge) return unauthorized(rep, "Passkey 登录失败");

    const passkey = await db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, input.response.id))
      .limit(1)
      .then((rows) => rows[0]);
    if (!passkey) return unauthorized(rep, "Passkey 登录失败");

    const user = await db
      .select()
      .from(users)
      .where(and(eq(users.id, passkey.userId), eq(users.status, "active"), isNull(users.deletedAt)))
      .limit(1)
      .then((rows) => rows[0]);
    if (!user) return unauthorized(rep, "Passkey 登录失败");

    const verification = await verifyStoredPasskey(
      db,
      req,
      user,
      passkey,
      input.response,
      challenge.challengeHash,
      relyingParty,
    );
    if (!verification) return unauthorized(rep, "Passkey 登录失败");

    const claimed = await db
      .update(webauthnChallenges)
      .set({ usedAt: now })
      .where(
        and(
          eq(webauthnChallenges.id, input.ceremonyId),
          isNull(webauthnChallenges.usedAt),
          gt(webauthnChallenges.expiresAt, now),
        ),
      );
    if (claimed.changes !== 1) return unauthorized(rep, "Passkey 登录失败");

    await db
      .update(passkeys)
      .set({
        counter: verification.authenticationInfo.newCounter,
        deviceType: verification.authenticationInfo.credentialDeviceType,
        backedUp: verification.authenticationInfo.credentialBackedUp,
        lastUsedAt: now,
      })
      .where(eq(passkeys.id, passkey.id));

    const environment = requestEnvironment(req);
    const { deviceId, newDevice } = await upsertPasskeyDevice(
      db,
      user.id,
      input.device,
      environment,
      now,
    );
    const { accessToken, refreshToken, sessionId } = await issueSession(
      db,
      config,
      user.id,
      deviceId,
      "passkey",
      req,
      rep,
    );
    await db.insert(auditEvents).values({
      id: newId("aud"),
      userId: user.id,
      deviceId,
      sessionId,
      type: "user.login",
      targetType: "user",
      targetId: user.id,
      metadata: JSON.stringify({
        authMethod: "passkey",
        passkeyId: passkey.id,
        sessionId,
        deviceId,
        newDevice,
        ipPrefix: environment.ipPrefix,
        userAgentSummary: environment.userAgentSummary,
      }),
      createdAt: now,
    });

    return {
      user: { id: user.id, email: user.emailNormalized, role: user.role },
      deviceId,
      accessToken,
      refreshToken,
      expiresIn: config.accessTokenTtl,
    };
  });
}
