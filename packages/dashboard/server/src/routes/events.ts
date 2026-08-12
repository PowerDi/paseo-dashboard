import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import type { ConfigEventBus } from "../lib/event-bus.js";
import type { Db } from "../db/index.js";

export function registerEventRoutes(app: FastifyInstance, db: Db, eventBus: ConfigEventBus) {
  const auth = requireAuth(db);

  // ── GET /api/v1/events (SSE) ───────────────────────
  //
  // Server-Sent Events stream for configuration notifications.
  // Only carries Dashboard config events (host changes, device/session
  // revocation). Never carries daemon data, agent output, or binary frames.
  app.get("/api/v1/events", { preHandler: auth }, (req, rep) => {
    const userId = req.auth!.userId;

    rep.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Send a comment to flush headers immediately
    rep.raw.write(": connected\n\n");

    const unsubscribe = eventBus.subscribe(userId, (event) => {
      rep.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Heartbeat every 30s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      rep.raw.write(": heartbeat\n\n");
    }, 30_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
