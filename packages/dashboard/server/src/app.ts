import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { createDb } from "./db/index.js";
import { ensureTables } from "./db/migrate.js";
import { loadKek } from "./lib/kek.js";
import { createHash } from "node:crypto";
import { EnvelopeEncryptor } from "./lib/encryption.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHostRoutes } from "./routes/hosts.js";
import { registerSyncRoutes } from "./routes/sync.js";
import type { ServerConfig } from "./config.js";

/** Truncate IPv4 to /24, IPv6 to /64 for audit storage. */
export function truncateIp(ip: string): string {
  if (ip.includes(":")) {
    // IPv6 — keep first 4 groups
    const groups = ip.split(":");
    return groups.slice(0, 4).join(":") + "::";
  }
  const parts = ip.split(".");
  if (parts.length === 4) {
    return parts.slice(0, 3).join(".") + ".0";
  }
  return ip;
}

export function buildApp(config: ServerConfig) {
  // Data directory
  ensureTables(config.dataDir);
  const db = createDb(config.dataDir);

  // KEK + encryptor
  const kek = loadKek(config.kekFile);
  const encryptor = new EnvelopeEncryptor(kek);
  const fingerprintSecret = createHash("sha256")
    .update(kek)
    .update("capability-fingerprint-v1")
    .digest();

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.password",
          "req.body.currentPassword",
          "req.body.newPassword",
          "req.body.refreshToken",
          "req.body.token",
          "req.body.resetToken",
          "req.body.connection",
          "req.body.email",
          "res.body.connection",
          "res.body.accessToken",
          "res.body.refreshToken",
        ],
        censor: "[REDACTED]",
      },
    },
    trustProxy: config.trustedProxies.length > 0 ? config.trustedProxies : false,
  });

  // Plugins
  app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  });

  app.register(cookie);

  // Global error handler — prevent req.body from leaking into logs on
  // unhandled errors. Route-level errors use sendError() which only returns
  // code/message/requestId.
  app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, req, rep) => {
    req.log.error(
      {
        err: {
          message: error.message,
          code: error.code,
          statusCode: error.statusCode,
        },
      },
      "Unhandled error",
    );
    rep.status(error.statusCode ?? 500).send({
      error: {
        code: "internal_error",
        message: "服务器内部错误",
        requestId: req.id,
      },
    });
  });

  // Routes
  app.get("/health", async () => ({ status: "ok", version: "0.1.0" }));
  registerAuthRoutes(app, db, config);
  registerHostRoutes(app, db, encryptor, fingerprintSecret);
  registerSyncRoutes(app, db, encryptor);

  return app;
}
