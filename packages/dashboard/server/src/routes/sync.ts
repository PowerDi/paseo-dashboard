import type { FastifyInstance } from "fastify";
import { eq, and, gt, asc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { badRequest } from "../lib/http.js";
import { hosts, hostConnections, users, devices } from "../db/schema.js";
import { EnvelopeEncryptor } from "../lib/encryption.js";
import type { Db } from "../db/index.js";
import type { SyncChange } from "@getpaseo/dashboard-shared";

export function registerSyncRoutes(app: FastifyInstance, db: Db, encryptor: EnvelopeEncryptor) {
  const auth = requireAuth(db);

  // GET /api/v1/host-sync?after=N&limit=100
  //
  // Incremental sync: returns all host changes whose lastSyncRevision is
  // strictly greater than `after`. Each mutation (import/update/delete) bumps
  // user.syncRevision and stamps lastSyncRevision on the host row in the same
  // transaction, so the cursor is the global account-level revision.
  //
  // The client persists the highest revision it has applied and sends it as
  // `after` on the next poll. Repeated application is idempotent: an upsert
  // with the same revision overwrites the same state; a delete with the same
  // tombstone is a no-op.
  app.get("/api/v1/host-sync", { preHandler: auth }, async (req, rep) => {
    const userId = req.auth!.userId;
    const query = req.query as { after?: string; limit?: string };
    const after = parseInt(query.after || "0", 10);
    const limit = Math.min(Math.max(parseInt(query.limit || "100", 10), 1), 500);

    if (Number.isNaN(after)) return badRequest(rep, "after 必须为数字");

    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (userRow.length === 0) return badRequest(rep, "用户不存在");
    const toRevision = userRow[0].syncRevision;

    // No changes since the cursor — return empty delta.
    if (toRevision <= after) {
      await db
        .update(devices)
        .set({ lastSyncedRevision: toRevision })
        .where(eq(devices.id, req.auth!.deviceId));
      rep.header("Cache-Control", "no-store");
      return { fromRevision: after, toRevision, changes: [], hasMore: false };
    }

    // Query host rows whose lastSyncRevision exceeds the cursor.
    const rows = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.ownerUserId, userId), gt(hosts.lastSyncRevision, after)))
      .orderBy(asc(hosts.lastSyncRevision))
      .limit(limit);

    const changes: SyncChange[] = [];

    for (const h of rows) {
      if (h.deletedAt) {
        changes.push({
          revision: h.lastSyncRevision,
          operation: "delete",
          hostId: h.id,
          deletedAt: h.deletedAt,
        });
      } else {
        const connRows = await db
          .select()
          .from(hostConnections)
          .where(eq(hostConnections.hostId, h.id))
          .limit(1);
        const conn = connRows[0];
        if (!conn) continue;

        let connection: Record<string, unknown>;
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
          continue;
        }

        changes.push({
          revision: h.lastSyncRevision,
          operation: "upsert",
          host: {
            id: h.id,
            label: h.label,
            version: h.version,
            connection: connection as never,
            createdAt: h.createdAt,
            updatedAt: h.updatedAt,
          },
        });
      }
    }

    // hasMore is true when we hit the limit — the client should poll again
    // with after = last change's revision. When false, the client is caught
    // up to toRevision.
    await db
      .update(devices)
      .set({ lastSyncedRevision: toRevision })
      .where(eq(devices.id, req.auth!.deviceId));

    rep.header("Cache-Control", "no-store");
    return {
      fromRevision: after,
      toRevision,
      changes,
      hasMore: changes.length >= limit,
    };
  });
}
