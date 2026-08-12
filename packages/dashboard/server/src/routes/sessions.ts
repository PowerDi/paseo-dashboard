import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { newId } from "../lib/id.js";
import { requireAuth } from "../lib/auth.js";
import { notFound } from "../lib/http.js";
import { sessions, devices, auditEvents } from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { ConfigEventBus } from "../lib/event-bus.js";
import type { Session } from "@getpaseo/dashboard-shared";

export function registerSessionRoutes(app: FastifyInstance, db: Db, eventBus: ConfigEventBus) {
  const auth = requireAuth(db);

  // ── GET /api/v1/sessions ────────────────────────────
  app.get("/api/v1/sessions", { preHandler: auth }, async (req, rep) => {
    const userId = req.auth!.userId;
    const currentSessionId = req.auth!.sessionId;

    // Join sessions with devices to get device name
    const rows = await db
      .select({
        session: sessions,
        deviceName: devices.displayName,
      })
      .from(sessions)
      .innerJoin(devices, eq(sessions.deviceId, devices.id))
      .where(eq(sessions.userId, userId));

    const result: (Session & { isCurrentSession: boolean })[] = rows
      .filter((r) => r.session.revokedAt === null)
      .map((r) => ({
        id: r.session.id,
        deviceId: r.session.deviceId,
        deviceName: r.deviceName,
        createdAt: r.session.createdAt,
        lastUsedAt: r.session.lastUsedAt,
        expiresAt: r.session.expiresAt,
        revokedAt: r.session.revokedAt,
        isCurrentSession: r.session.id === currentSessionId,
      }));

    rep.header("Cache-Control", "no-store");
    return result;
  });

  // ── DELETE /api/v1/sessions/:id ─────────────────────
  app.delete("/api/v1/sessions/:id", { preHandler: auth }, async (req, rep) => {
    const { id } = req.params as { id: string };
    const userId = req.auth!.userId;

    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .limit(1);
    if (rows.length === 0) return notFound(rep, "Session 不存在");

    const session = rows[0];
    if (session.revokedAt) {
      rep.header("Cache-Control", "no-store");
      return { ok: true };
    }

    const now = new Date().toISOString();
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, id));

    await db.insert(auditEvents).values({
      id: newId("aud"),
      userId,
      deviceId: session.deviceId,
      sessionId: req.auth!.sessionId,
      type: "session.revoked",
      targetType: "session",
      targetId: id,
      metadata: JSON.stringify({}),
      createdAt: now,
    });

    eventBus.emit(userId, {
      type: "session.revoked",
      revision: 0,
      timestamp: now,
      data: { sessionId: id },
    });

    rep.header("Cache-Control", "no-store");
    return { ok: true };
  });
}
