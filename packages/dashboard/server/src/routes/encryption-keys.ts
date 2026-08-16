import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { auditEvents, users } from "../db/schema.js";
import type { Db } from "../db/index.js";
import { requireAuth } from "../lib/auth.js";
import { newId } from "../lib/id.js";
import { badRequest, forbidden, unauthorized } from "../lib/http.js";
import { EncryptionKeyError, type EncryptionKeyManager } from "../lib/key-manager.js";
import { KeyProviderError } from "../lib/key-provider.js";

interface RotateKeyRequest {
  currentPassword?: unknown;
  keyFile?: unknown;
}

export function registerEncryptionKeyRoutes(
  app: FastifyInstance,
  db: Db,
  keyManager: EncryptionKeyManager,
) {
  const auth = requireAuth(db);

  async function requireAdmin(userId: string): Promise<boolean> {
    const actor = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((rows) => rows[0]);
    return actor?.role === "admin";
  }

  app.get("/api/v1/admin/encryption-keys", { preHandler: auth }, async (req, rep) => {
    if (!(await requireAdmin(req.auth!.userId))) return forbidden(rep);
    rep.header("Cache-Control", "no-store");
    return {
      rotationProvider: keyManager.rotationProvider,
      activeVersion: keyManager.activeVersion,
      keys: await keyManager.status(),
    };
  });

  app.post("/api/v1/admin/encryption-keys/rotate", { preHandler: auth }, async (req, rep) => {
    const userId = req.auth!.userId;
    if (!(await requireAdmin(userId))) return forbidden(rep);

    const body = (req.body ?? {}) as RotateKeyRequest;
    if (typeof body.currentPassword !== "string" || !body.currentPassword) {
      return badRequest(rep, "currentPassword 为必填");
    }
    if (body.keyFile !== undefined && typeof body.keyFile !== "string") {
      return badRequest(rep, "keyFile 必须为字符串");
    }

    const user = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((rows) => rows[0]);
    if (!user || !(await argon2.verify(user.passwordHash, body.currentPassword))) {
      return unauthorized(rep, "当前密码错误");
    }

    const currentStatus = await keyManager.status();
    const hasPendingRotation = currentStatus.some((key) => key.status === "decrypt_only");
    const keyFile = typeof body.keyFile === "string" ? body.keyFile.trim() : "";
    if (keyManager.rotationProvider === "file" && !hasPendingRotation && !keyFile) {
      return badRequest(rep, "file KeyProvider 轮换必须提供 keyFile");
    }

    let result;
    try {
      result = await keyManager.rotate(keyFile || undefined);
    } catch (error) {
      if (error instanceof KeyProviderError || error instanceof EncryptionKeyError) {
        return badRequest(rep, error.message);
      }
      throw error;
    }

    const now = new Date().toISOString();
    await db.insert(auditEvents).values({
      id: newId("aud"),
      userId,
      deviceId: req.auth!.deviceId,
      sessionId: req.auth!.sessionId,
      type: "encryption_key.rotated",
      targetType: "encryption_key",
      targetId: result.activeVersion,
      metadata: JSON.stringify({
        provider: result.provider,
        previousVersion: result.previousVersion,
        activeVersion: result.activeVersion,
        retiredVersion: result.retiredVersion,
        rewrappedConnections: result.rewrappedConnections,
      }),
      createdAt: now,
    });

    rep.header("Cache-Control", "no-store");
    return { result, keys: await keyManager.status() };
  });
}
