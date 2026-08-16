import type { FastifyInstance } from "fastify";
import { eq, and, isNull } from "drizzle-orm";
import { newId } from "../lib/id.js";
import { requireAuth } from "../lib/auth.js";
import { badRequest, notFound } from "../lib/http.js";
import { devices, sessions, auditEvents } from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { ConfigEventBus } from "../lib/event-bus.js";
import type { Device } from "@getpaseo/dashboard-shared";

export function registerDeviceRoutes(app: FastifyInstance, db: Db, eventBus: ConfigEventBus) {
  const auth = requireAuth(db);

  // ── GET /api/v1/devices ─────────────────────────────
  app.get("/api/v1/devices", { preHandler: auth }, async (req, rep) => {
    const userId = req.auth!.userId;
    const currentDeviceId = req.auth!.deviceId;

    const rows = await db.select().from(devices).where(eq(devices.userId, userId));

    const result: Device[] = rows.map((d) => ({
      id: d.id,
      displayName: d.displayName,
      platform: d.platform,
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
      lastIpPrefix: d.lastIpPrefix,
      lastUserAgentSummary: d.lastUserAgentSummary,
      lastAuthMethod: d.lastAuthMethod,
      revokedAt: d.revokedAt,
      lastSyncedRevision: d.lastSyncedRevision,
      isCurrentDevice: d.id === currentDeviceId,
    }));

    rep.header("Cache-Control", "no-store");
    return result;
  });

  // ── DELETE /api/v1/devices/:id ──────────────────────
  app.delete("/api/v1/devices/:id", { preHandler: auth }, async (req, rep) => {
    const { id } = req.params as { id: string };
    const userId = req.auth!.userId;
    const currentDeviceId = req.auth!.deviceId;

    if (id === currentDeviceId) {
      return badRequest(rep, "不能撤销当前设备，请使用登出");
    }

    const rows = await db
      .select()
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.userId, userId)))
      .limit(1);
    if (rows.length === 0) return notFound(rep, "设备不存在");

    const device = rows[0];
    if (device.revokedAt) {
      // Idempotent — already revoked
      rep.header("Cache-Control", "no-store");
      return { ok: true };
    }

    const now = new Date().toISOString();

    db.transaction((tx) => {
      tx.update(devices).set({ revokedAt: now }).where(eq(devices.id, id)).run();
      // Revoke all sessions for this device
      tx.update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.deviceId, id), isNull(sessions.revokedAt)))
        .run();
    });

    // Audit — outside transaction since better-sqlite3 sync transaction
    // already committed by the time we reach here
    await db.insert(auditEvents).values({
      id: newId("aud"),
      userId,
      deviceId: id,
      sessionId: req.auth!.sessionId,
      type: "device.revoked",
      targetType: "device",
      targetId: id,
      metadata: JSON.stringify({ deviceName: device.displayName }),
      createdAt: now,
    });

    eventBus.emit(userId, {
      type: "device.revoked",
      revision: 0,
      timestamp: now,
      data: { deviceId: id, deviceName: device.displayName },
    });

    rep.header("Cache-Control", "no-store");
    return { ok: true };
  });
}
