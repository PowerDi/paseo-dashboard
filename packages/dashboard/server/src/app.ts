import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { createDb } from "./db/index.js";
import { ensureTables } from "./db/migrate.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHostRoutes } from "./routes/hosts.js";
import { registerSyncRoutes } from "./routes/sync.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { registerPasskeyRoutes } from "./routes/passkeys.js";
import { registerEncryptionKeyRoutes } from "./routes/encryption-keys.js";
import { ConfigEventBus } from "./lib/event-bus.js";
import { setupSecurity } from "./lib/security.js";
import { EncryptionKeyManager } from "./lib/key-manager.js";
import { createKeyProviderSet, type KeyProviderSet } from "./lib/key-provider.js";
import type { ServerConfig } from "./config.js";

export interface BuildAppOptions {
  keyProviders?: KeyProviderSet;
}

export function buildApp(config: ServerConfig, options: BuildAppOptions = {}) {
  ensureTables(config.dataDir);
  const db = createDb(config.dataDir);
  const keyManager = new EncryptionKeyManager(
    db,
    options.keyProviders ?? createKeyProviderSet(config),
  );

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.password",
          "req.body.currentPassword",
          "req.body.keyFile",
          "req.body.newPassword",
          "req.body.refreshToken",
          "req.body.inviteToken",
          "req.body.token",
          "req.body.resetToken",
          "req.body.connection",
          "req.body.email",
          "req.body.response",
          "res.body.connection",
          "res.body.accessToken",
          "res.body.refreshToken",
          "res.body.token",
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

  app.addHook("onReady", async () => {
    await keyManager.initialize();
  });
  app.addHook("onClose", async () => {
    db.close();
  });

  // Security middleware (rate limit, Origin validation, CSP)
  const { rateLimits } = setupSecurity(app, config.corsOrigin, config.rateLimitEnabled);

  // Routes
  app.get("/health", async () => ({ status: "ok", version: "0.1.0" }));
  registerAuthRoutes(app, db, config);
  registerPasskeyRoutes(app, db, config);
  registerInvitationRoutes(app, db);
  const eventBus = new ConfigEventBus();
  app.decorate("eventBus", eventBus);
  registerEventRoutes(app, db, eventBus);
  registerHostRoutes(app, db, keyManager, eventBus, rateLimits);
  registerSyncRoutes(app, db, keyManager);
  registerEncryptionKeyRoutes(app, db, keyManager);
  registerDeviceRoutes(app, db, eventBus);
  registerSessionRoutes(app, db, eventBus);
  registerAuditRoutes(app, db);

  return app;
}
