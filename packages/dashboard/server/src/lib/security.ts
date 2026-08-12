/**
 * Security middleware: rate limiting, Origin validation, CSP headers.
 * All in-memory, no external dependencies.
 */

import type { FastifyInstance } from "fastify";

interface RateBucket {
  count: number;
  windowStart: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  "auth.login": { maxRequests: 10, windowMs: 60_000 },
  "auth.register": { maxRequests: 3, windowMs: 60_000 },
  "auth.refresh": { maxRequests: 20, windowMs: 60_000 },
  "auth.change-password": { maxRequests: 5, windowMs: 60_000 },
};

const RATE_LIMIT_ROUTES: Record<string, string> = {
  "POST:/api/v1/auth/login": "auth.login",
  "POST:/api/v1/auth/register": "auth.register",
  "POST:/api/v1/auth/refresh": "auth.refresh",
  "POST:/api/v1/auth/change-password": "auth.change-password",
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
  const limiter = new RateLimiter();
  const cleanupInterval = setInterval(() => limiter.cleanup(), 300_000);
  app.addHook("onClose", () => clearInterval(cleanupInterval));

  // Rate limiting on auth endpoints
  if (rateLimitEnabled) {
    app.addHook("onRequest", async (req, rep) => {
      const url = req.url;
      const method = req.method;

      const routeKey = `${method}:${url}`;
      const scope = RATE_LIMIT_ROUTES[routeKey] ?? null;

      if (!scope) return;
      if (!limiter.check(`${scope}:${req.ip}`, DEFAULT_RATE_LIMITS[scope])) {
        return rep.status(429).send({
          error: {
            code: "rate_limited",
            message: "请求过于频繁，请稍后再试",
            requestId: req.id,
          },
        });
      }
    });
  }

  // Origin validation for state-changing requests
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

  // Security headers on all responses
  app.addHook("onSend", async (req, rep, payload) => {
    rep.header("Content-Security-Policy", CSP_HEADER);
    rep.header("X-Content-Type-Options", "nosniff");
    rep.header("X-Frame-Options", "DENY");
    rep.header("Referrer-Policy", "strict-origin-when-cross-origin");
    return payload;
  });

  return { limiter };
}
