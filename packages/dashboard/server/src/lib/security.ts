import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { rateLimited } from "./http.js";

interface RateBucket {
  count: number;
  windowStart: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const DEFAULT_RATE_LIMITS = {
  "auth.login.ip": { maxRequests: 10, windowMs: 60_000 },
  "auth.login.account": { maxRequests: 5, windowMs: 60_000 },
  "auth.login.device": { maxRequests: 5, windowMs: 60_000 },
  "auth.register.ip": { maxRequests: 3, windowMs: 60_000 },
  "auth.register.account": { maxRequests: 3, windowMs: 60_000 },
  "auth.register.device": { maxRequests: 3, windowMs: 60_000 },
  "auth.refresh.ip": { maxRequests: 20, windowMs: 60_000 },
  "auth.refresh.credential": { maxRequests: 10, windowMs: 60_000 },
  "auth.change-password.ip": { maxRequests: 5, windowMs: 60_000 },
  "auth.passkey.options.ip": { maxRequests: 20, windowMs: 60_000 },
  "auth.passkey.verify.ip": { maxRequests: 10, windowMs: 60_000 },
  "auth.passkey.verify.credential": { maxRequests: 5, windowMs: 60_000 },
  "passkey.registration.ip": { maxRequests: 10, windowMs: 60_000 },
  "host.import.ip": { maxRequests: 20, windowMs: 60_000 },
  "host.import.account": { maxRequests: 10, windowMs: 60_000 },
  "admin.encryption.rotate.ip": { maxRequests: 3, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitScope = keyof typeof DEFAULT_RATE_LIMITS;

interface RouteRateLimitPolicy {
  ip: RateLimitScope;
  account?: RateLimitScope;
  device?: RateLimitScope;
  credential?: RateLimitScope;
  passkeyCredential?: RateLimitScope;
}

const RATE_LIMIT_ROUTES: Record<string, RouteRateLimitPolicy> = {
  "POST:/api/v1/auth/login": {
    ip: "auth.login.ip",
    account: "auth.login.account",
    device: "auth.login.device",
  },
  "POST:/api/v1/auth/register": {
    ip: "auth.register.ip",
    account: "auth.register.account",
    device: "auth.register.device",
  },
  "POST:/api/v1/auth/refresh": {
    ip: "auth.refresh.ip",
    credential: "auth.refresh.credential",
  },
  "POST:/api/v1/auth/change-password": { ip: "auth.change-password.ip" },
  "POST:/api/v1/auth/passkey/login/options": { ip: "auth.passkey.options.ip" },
  "POST:/api/v1/auth/passkey/login/verify": {
    ip: "auth.passkey.verify.ip",
    passkeyCredential: "auth.passkey.verify.credential",
  },
  "POST:/api/v1/passkeys/registration/options": { ip: "passkey.registration.ip" },
  "POST:/api/v1/passkeys/registration/verify": { ip: "passkey.registration.ip" },
  "POST:/api/v1/hosts/import": { ip: "host.import.ip" },
  "POST:/api/v1/admin/encryption-keys/rotate": { ip: "admin.encryption.rotate.ip" },
};

const STATE_CHANGING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const CSP_HEADER =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "connect-src 'self' ws: wss:; img-src 'self' data: blob:; font-src 'self' data:; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none';";

class RateLimiter {
  private buckets = new Map<string, RateBucket>();

  check(key: string, config: RateLimitConfig): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= config.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= config.maxRequests;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= 300_000) this.buckets.delete(key);
    }
  }
}

export interface RateLimits {
  check(scope: RateLimitScope, identity: string): boolean;
}

class InMemoryRateLimits implements RateLimits {
  private limiter = new RateLimiter();

  constructor(private enabled: boolean) {}

  check(scope: RateLimitScope, identity: string): boolean {
    if (!this.enabled) return true;
    const identityHash = createHash("sha256").update(identity).digest("hex");
    return this.limiter.check(`${scope}:${identityHash}`, DEFAULT_RATE_LIMITS[scope]);
  }

  cleanup(): void {
    this.limiter.cleanup();
  }
}

function requestPath(url: string): string {
  return url.split("?", 1)[0];
}

function requestBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function deviceInstallationId(body: Record<string, unknown>): string | null {
  const device = requestBody(body.device);
  return typeof device?.installationId === "string" ? device.installationId : null;
}

function bodyLimitExceeded(
  policy: RouteRateLimitPolicy,
  body: Record<string, unknown> | null,
  rateLimits: RateLimits,
): boolean {
  if (!body) return false;

  if (policy.account && typeof body.email === "string") {
    const email = body.email.toLowerCase().trim();
    if (email && !rateLimits.check(policy.account, email)) return true;
  }

  if (policy.device) {
    const installationId = deviceInstallationId(body);
    if (installationId && !rateLimits.check(policy.device, installationId)) return true;
  }

  if (policy.credential && typeof body.refreshToken === "string" && body.refreshToken) {
    if (!rateLimits.check(policy.credential, body.refreshToken)) return true;
  }

  if (policy.passkeyCredential) {
    const response = requestBody(body.response);
    if (typeof response?.id === "string" && response.id) {
      if (!rateLimits.check(policy.passkeyCredential, response.id)) return true;
    }
  }

  return false;
}

function originMatches(origin: string | undefined, allowedOrigin: string): boolean {
  if (!origin) return true;
  if (allowedOrigin === "*") return true;
  try {
    return new URL(allowedOrigin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function setupSecurity(
  app: FastifyInstance,
  allowedOrigin: string,
  rateLimitEnabled: boolean = true,
) {
  const rateLimits = new InMemoryRateLimits(rateLimitEnabled);
  const cleanupInterval = setInterval(() => rateLimits.cleanup(), 300_000);
  app.addHook("onClose", () => clearInterval(cleanupInterval));

  if (rateLimitEnabled) {
    app.addHook("onRequest", async (req, rep) => {
      const policy = RATE_LIMIT_ROUTES[`${req.method}:${requestPath(req.url)}`];
      if (policy && !rateLimits.check(policy.ip, req.ip)) return rateLimited(rep);
    });

    app.addHook("preHandler", async (req, rep) => {
      const policy = RATE_LIMIT_ROUTES[`${req.method}:${requestPath(req.url)}`];
      if (policy && bodyLimitExceeded(policy, requestBody(req.body), rateLimits)) {
        return rateLimited(rep);
      }
    });
  }

  app.addHook("preHandler", async (req, rep) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) return;
    if (req.url.startsWith("/health")) return;
    const origin = req.headers.origin;
    if (origin && !originMatches(origin, allowedOrigin)) {
      return rep.status(403).send({
        error: {
          code: "forbidden",
          message: "Origin 不被允许",
          requestId: req.id,
        },
      });
    }
  });

  app.addHook("onSend", async (req, rep, payload) => {
    rep.header("Content-Security-Policy", CSP_HEADER);
    rep.header("X-Content-Type-Options", "nosniff");
    rep.header("X-Frame-Options", "DENY");
    rep.header("Referrer-Policy", "strict-origin-when-cross-origin");
    return payload;
  });

  return { rateLimits };
}
