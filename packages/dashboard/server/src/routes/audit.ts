import type { FastifyInstance } from "fastify";
import { eq, and, lt, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { badRequest } from "../lib/http.js";
import { auditEvents } from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { AuditEvent, AuditEventListResponse } from "@getpaseo/dashboard-shared";

export function registerAuditRoutes(app: FastifyInstance, db: Db) {
  const auth = requireAuth(db);

  // ── GET /api/v1/audit-events?cursor=...&limit=50 ──
  //
  // Cursor-based pagination using ULID (time-sortable). Returns newest first.
  // The cursor is the ID of the last (oldest) item in the current batch.
  // Only returns events for the authenticated user — no cross-user access.
  app.get("/api/v1/audit-events", { preHandler: auth }, async (req, rep) => {
    const userId = req.auth!.userId;
    const query = req.query as { cursor?: string; limit?: string };
    const limit = Math.min(Math.max(parseInt(query.limit || "50", 10), 1), 200);
    const cursor = query.cursor?.trim() || null;

    if (Number.isNaN(limit)) return badRequest(rep, "limit 必须为数字");

    const conditions = [eq(auditEvents.userId, userId)];
    if (cursor) {
      conditions.push(lt(auditEvents.id, cursor));
    }

    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.id))
      .limit(limit);

    const events: AuditEvent[] = rows.map((e) => ({
      id: e.id,
      type: e.type,
      targetType: e.targetType ?? "",
      targetId: e.targetId ?? "",
      metadata: e.metadata ? (JSON.parse(e.metadata) as Record<string, unknown>) : {},
      createdAt: e.createdAt,
    }));

    const nextCursor = events.length === limit ? events[events.length - 1].id : null;

    rep.header("Cache-Control", "no-store");
    const response: AuditEventListResponse = { events, nextCursor };
    return response;
  });
}
