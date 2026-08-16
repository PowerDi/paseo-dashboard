import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, and, isNull, desc } from "drizzle-orm";
import { newId } from "../lib/id.js";
import { requireAuth } from "../lib/auth.js";
import { badRequest, notFound, conflict, internal, rateLimited } from "../lib/http.js";
import { hosts, hostConnections, users, auditEvents } from "../db/schema.js";
import { EnvelopeEncryptor, capabilityFingerprint } from "../lib/encryption.js";
import { ErrorCodes } from "@getpaseo/dashboard-shared";
import type { Db } from "../db/index.js";
import type { ConfigEventBus } from "../lib/event-bus.js";
import type { RateLimits } from "../lib/security.js";

/**
 * Derive a domain-separated HMAC secret from the KEK for capability
 * fingerprinting. This is NOT the KEK itself — it cannot decrypt anything.
 */

export function registerHostRoutes(
  app: FastifyInstance,
  db: Db,
  encryptor: EnvelopeEncryptor,
  fingerprintSecret: Buffer,
  eventBus: ConfigEventBus,
  rateLimits: RateLimits,
) {
  const auth = requireAuth(db);

  async function enforceHostImportRateLimit(req: FastifyRequest, rep: FastifyReply) {
    if (!rateLimits.check("host.import.account", req.auth!.userId)) return rateLimited(rep);
  }

  const importGuards = [auth, enforceHostImportRateLimit];

  // ── POST /api/v1/hosts/import ──────────────────────
  app.post("/api/v1/hosts/import", { preHandler: importGuards }, async (req, rep) => {
    const { label, connection, clientVerification, idempotencyKey } = req.body as {
      label: string;
      connection: {
        type: string;
        serverId: string;
        relayEndpoint: string;
        useTls: boolean;
        daemonPublicKeyB64: string;
      };
      clientVerification: { verifiedAt: string; serverVersion: string };
      idempotencyKey: string;
    };

    if (
      !label ||
      !connection?.serverId ||
      !connection?.relayEndpoint ||
      !connection?.daemonPublicKeyB64
    ) {
      return badRequest(rep, "label 和 connection 字段不完整");
    }
    if (connection.type !== "relay") {
      return badRequest(rep, "仅支持 relay 类型连接");
    }
    if (!clientVerification?.verifiedAt) {
      return badRequest(rep, "缺少 clientVerification.verifiedAt");
    }
    if (!idempotencyKey) {
      return badRequest(rep, "缺少 idempotencyKey");
    }

    const userId = req.auth!.userId;

    const connectionJson = JSON.stringify({
      type: "relay",
      serverId: connection.serverId,
      relayEndpoint: connection.relayEndpoint,
      useTls: connection.useTls ?? true,
      daemonPublicKeyB64: connection.daemonPublicKeyB64,
    });

    const fp = capabilityFingerprint(fingerprintSecret, connectionJson);
    const now = new Date().toISOString();

    // Idempotency check: if this user already imported with the same key,
    // return the existing host.
    const idemRows = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.ownerUserId, userId), eq(hosts.idempotencyKey, idempotencyKey)))
      .limit(1);

    if (idemRows.length > 0) {
      const existing = idemRows[0];
      if (existing.deletedAt) {
        return conflict(rep, ErrorCodes.IDEMPOTENCY_CONFLICT, "幂等键对应的 Host 已被删除");
      }
      // Return existing host (idempotent)
      const connRows = await db
        .select()
        .from(hostConnections)
        .where(eq(hostConnections.hostId, existing.id))
        .limit(1);
      const conn = connRows[0];
      if (!conn) return internal(rep, "Host 配置缺失");

      let existingConnection;
      try {
        existingConnection = JSON.parse(
          encryptor.decrypt(
            {
              payload: conn.encryptedPayload,
              dek: conn.encryptedDek,
              nonce: conn.nonce,
              tag: conn.authTag,
            },
            { userId, hostId: existing.id, connId: conn.id, keyVersion: conn.keyVersion },
          ),
        );
      } catch {
        return internal(rep, "无法解密 Host 配置");
      }

      const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      rep.header("Cache-Control", "no-store");
      return {
        host: {
          id: existing.id,
          label: existing.label,
          version: existing.version,
          connection: existingConnection,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        },
        syncRevision: userRow[0].syncRevision,
      };
    }

    // Dedup check: same capability already imported under a different label?
    const dupRows = await db
      .select()
      .from(hosts)
      .where(
        and(
          eq(hosts.ownerUserId, userId),
          eq(hosts.capabilityFingerprint, fp),
          isNull(hosts.deletedAt),
        ),
      )
      .limit(1);

    if (dupRows.length > 0) {
      return conflict(rep, ErrorCodes.HOST_VERSION_CONFLICT, "该 Host 已导入");
    }

    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (userRow.length === 0) return notFound(rep, "用户不存在");
    const newRevision = userRow[0].syncRevision + 1;

    const hostId = newId("hst");
    const connId = newId("conn");
    const keyVersion = "k1";

    const enc = encryptor.encrypt(connectionJson, {
      userId,
      hostId,
      connId,
      keyVersion,
    });

    db.transaction((tx) => {
      tx.insert(hosts)
        .values({
          id: hostId,
          ownerUserId: userId,
          label,
          version: 1,
          lastSyncRevision: newRevision,
          capabilityFingerprint: fp,
          idempotencyKey,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      tx.insert(hostConnections)
        .values({
          id: connId,
          hostId,
          kind: "relay",
          encryptedPayload: enc.payload,
          encryptedDek: enc.dek,
          keyVersion,
          nonce: enc.nonce,
          authTag: enc.tag,
        })
        .run();

      tx.update(users)
        .set({ syncRevision: newRevision, updatedAt: now })
        .where(eq(users.id, userId))
        .run();

      tx.insert(auditEvents)
        .values({
          id: newId("aud"),
          userId,
          type: "host.imported",
          targetType: "host",
          targetId: hostId,
          metadata: JSON.stringify({ label, verifiedAt: clientVerification.verifiedAt }),
          createdAt: now,
        })
        .run();
    });

    eventBus.emit(userId, {
      type: "host.upserted",
      revision: newRevision,
      timestamp: now,
      data: { hostId },
    });

    rep.header("Cache-Control", "no-store");
    return {
      host: {
        id: hostId,
        label,
        version: 1,
        connection: {
          type: "relay",
          serverId: connection.serverId,
          relayEndpoint: connection.relayEndpoint,
          useTls: connection.useTls ?? true,
          daemonPublicKeyB64: connection.daemonPublicKeyB64,
        },
        createdAt: now,
        updatedAt: now,
      },
      syncRevision: newRevision,
    };
  });

  // ── GET /api/v1/hosts ───────────────────────────────
  app.get("/api/v1/hosts", { preHandler: auth }, async (req, rep) => {
    const userId = req.auth!.userId;
    const rows = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.ownerUserId, userId), isNull(hosts.deletedAt)))
      .orderBy(desc(hosts.updatedAt));

    const result = [];
    for (const h of rows) {
      const connRows = await db
        .select()
        .from(hostConnections)
        .where(eq(hostConnections.hostId, h.id))
        .limit(1);
      const conn = connRows[0];
      if (!conn) continue;
      let connection;
      try {
        connection = JSON.parse(
          encryptor.decrypt(
            {
              payload: conn.encryptedPayload,
              dek: conn.encryptedDek,
              nonce: conn.nonce,
              tag: conn.authTag,
            },
            { userId, hostId: h.id, connId: conn.id, keyVersion: conn.keyVersion },
          ),
        );
      } catch {
        return internal(rep, "无法解密 Host 配置");
      }
      result.push({
        id: h.id,
        label: h.label,
        version: h.version,
        connection,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      });
    }

    rep.header("Cache-Control", "no-store");
    return result;
  });

  // ── PATCH /api/v1/hosts/:id ────────────────────────
  app.patch("/api/v1/hosts/:id", { preHandler: auth }, async (req, rep) => {
    const { id } = req.params as { id: string };
    const { label, baseVersion } = req.body as { label?: string; baseVersion: number };
    const userId = req.auth!.userId;

    if (!label || typeof label !== "string" || label.trim().length === 0) {
      return badRequest(rep, "label 为必填且不能为空");
    }
    if (typeof baseVersion !== "number" || baseVersion < 1) {
      return badRequest(rep, "baseVersion 为必填");
    }

    const rows = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, id), eq(hosts.ownerUserId, userId), isNull(hosts.deletedAt)))
      .limit(1);
    if (rows.length === 0) return notFound(rep, "Host 不存在");

    const host = rows[0];

    // Optimistic concurrency check
    if (host.version !== baseVersion) {
      return conflict(
        rep,
        ErrorCodes.HOST_VERSION_CONFLICT,
        `版本冲突：期望 ${baseVersion}，实际 ${host.version}`,
      );
    }

    const now = new Date().toISOString();
    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const newRevision = userRow[0].syncRevision + 1;
    const newVersion = host.version + 1;

    db.transaction((tx) => {
      tx.update(hosts)
        .set({
          label: label.trim(),
          version: newVersion,
          lastSyncRevision: newRevision,
          updatedAt: now,
        })
        .where(eq(hosts.id, id))
        .run();
      tx.update(users)
        .set({ syncRevision: newRevision, updatedAt: now })
        .where(eq(users.id, userId))
        .run();
      tx.insert(auditEvents)
        .values({
          id: newId("aud"),
          userId,
          type: "host.updated",
          targetType: "host",
          targetId: id,
          metadata: JSON.stringify({ label: label.trim(), version: newVersion }),
          createdAt: now,
        })
        .run();
    });

    // Return updated host with decrypted connection
    const connRows = await db
      .select()
      .from(hostConnections)
      .where(eq(hostConnections.hostId, id))
      .limit(1);
    const conn = connRows[0];
    let connection;
    try {
      connection = JSON.parse(
        encryptor.decrypt(
          {
            payload: conn.encryptedPayload,
            dek: conn.encryptedDek,
            nonce: conn.nonce,
            tag: conn.authTag,
          },
          { userId, hostId: id, connId: conn.id, keyVersion: conn.keyVersion },
        ),
      );
    } catch {
      return internal(rep, "无法解密 Host 配置");
    }

    rep.header("Cache-Control", "no-store");
    eventBus.emit(userId, {
      type: "host.upserted",
      revision: newRevision,
      timestamp: now,
      data: { hostId: id },
    });
    return {
      host: {
        id,
        label: label.trim(),
        version: newVersion,
        connection,
        createdAt: host.createdAt,
        updatedAt: now,
      },
      syncRevision: newRevision,
    };
  });

  // ── DELETE /api/v1/hosts/:id (tombstone) ───────────
  app.delete("/api/v1/hosts/:id", { preHandler: auth }, async (req, rep) => {
    const { id } = req.params as { id: string };
    const userId = req.auth!.userId;

    const rows = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.id, id), eq(hosts.ownerUserId, userId), isNull(hosts.deletedAt)))
      .limit(1);
    if (rows.length === 0) return notFound(rep, "Host 不存在");

    const now = new Date().toISOString();
    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const newRevision = userRow[0].syncRevision + 1;

    db.transaction((tx) => {
      tx.update(hosts)
        .set({ deletedAt: now, lastSyncRevision: newRevision, updatedAt: now })
        .where(eq(hosts.id, id))
        .run();
      tx.update(users)
        .set({ syncRevision: newRevision, updatedAt: now })
        .where(eq(users.id, userId))
        .run();
      tx.insert(auditEvents)
        .values({
          id: newId("aud"),
          userId,
          type: "host.deleted",
          targetType: "host",
          targetId: id,
          metadata: JSON.stringify({}),
          createdAt: now,
        })
        .run();
    });

    rep.header("Cache-Control", "no-store");
    eventBus.emit(userId, {
      type: "host.deleted",
      revision: newRevision,
      timestamp: now,
      data: { hostId: id },
    });

    return { ok: true, syncRevision: newRevision };
  });
}
