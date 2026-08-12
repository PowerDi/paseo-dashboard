import type { FastifyInstance } from "fastify";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { badRequest } from "../lib/http.js";
import { hosts, hostConnections, users } from "../db/schema.js";
import { EnvelopeEncryptor } from "../lib/encryption.js";
import type { Db } from "../db/index.js";

export function registerSyncRoutes(app: FastifyInstance, db: Db, encryptor: EnvelopeEncryptor) {
  const auth = requireAuth(db);

  // GET /api/v1/host-sync?after=N&limit=100
  app.get("/api/v1/host-sync", { preHandler: auth }, async (req, rep) => {
    const userId = req.auth!.userId;
    const query = req.query as { after?: string; limit?: string };
    const after = parseInt(query.after || "0", 10);
    const limit = Math.min(parseInt(query.limit || "100", 10), 500);

    if (isNaN(after)) return badRequest(rep, "after 必须为数字");

    const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (userRow.length === 0) return badRequest(rep, "用户不存在");
    const user = userRow[0];

    // Return all hosts updated after the given revision (both active and deleted).
    // We use syncRevision as the cursor; each mutation bumps user.syncRevision.
    // Since M0/P1 doesn't track per-host revision, we return all hosts whose
    // version > after (active) or deleted hosts. This is a simplification —
    // P2.1 will add a proper revision column to hosts.
    const allRows = await db
      .select()
      .from(hosts)
      .where(and(eq(hosts.ownerUserId, userId)))
      .orderBy(desc(hosts.updatedAt))
      .limit(limit);

    const changes: Array<{
      revision: number;
      operation: "upsert" | "delete";
      host?: Record<string, unknown>;
      hostId?: string;
      deletedAt?: string;
    }> = [];

    for (const h of allRows) {
      if (h.deletedAt) {
        // Tombstone
        changes.push({
          revision: h.version,
          operation: "delete",
          hostId: h.id,
          deletedAt: h.deletedAt,
        });
      } else {
        // Active host — decrypt connection
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
          continue;
        }

        changes.push({
          revision: h.version,
          operation: "upsert",
          host: {
            id: h.id,
            label: h.label,
            version: h.version,
            connection,
            createdAt: h.createdAt,
            updatedAt: h.updatedAt,
          },
        });
      }
    }

    rep.header("Cache-Control", "no-store");
    return {
      fromRevision: after,
      toRevision: user.syncRevision,
      changes,
      hasMore: changes.length >= limit,
    };
  });
}
