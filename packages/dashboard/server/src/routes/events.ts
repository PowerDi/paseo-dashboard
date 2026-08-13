import type { FastifyInstance } from "fastify";
import { requireAuth } from "../lib/auth.js";
import type { ConfigEventBus } from "../lib/event-bus.js";
import type { Db } from "../db/index.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

function lastEventIdFromHeader(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return 0;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function registerEventRoutes(app: FastifyInstance, db: Db, eventBus: ConfigEventBus) {
  const auth = requireAuth(db);

  // ── GET /api/v1/events (SSE) ───────────────────────
  //
  // Server-Sent Events stream for configuration notifications.
  // Only carries Dashboard config events (host changes, device/session
  // revocation). Never carries daemon data, agent output, or binary frames.
  app.get("/api/v1/events", { preHandler: auth }, (req, rep) => {
    const userId = req.auth!.userId;
    const lastEventId = lastEventIdFromHeader(req.headers["last-event-id"]);
    const response = rep.raw;

    // Fastify must not try to finish this response after the handler returns.
    rep.hijack();
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    let heartbeat: NodeJS.Timeout | undefined;
    let unsubscribe = () => {};

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      req.raw.removeListener("close", cleanup);
      response.removeListener("close", cleanup);
      response.removeListener("finish", cleanup);
    };

    const write = (chunk: string): boolean => {
      if (closed || response.destroyed || response.writableEnded || response.writableFinished) {
        cleanup();
        return false;
      }

      try {
        response.write(chunk);
        return true;
      } catch {
        cleanup();
        return false;
      }
    };

    req.raw.once("close", cleanup);
    response.once("close", cleanup);
    response.once("finish", cleanup);

    unsubscribe = eventBus.subscribe(
      userId,
      (event, eventId) => {
        write(`id: ${eventId}\ndata: ${JSON.stringify(event)}\n\n`);
      },
      { afterEventId: lastEventId },
    );
    if (closed) unsubscribe();

    // Send a comment to flush headers immediately.
    if (!write(": connected\n\n")) return;

    // Heartbeat every 30s to keep the connection alive through proxies.
    heartbeat = setInterval(() => {
      write(": heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);
  });
}
