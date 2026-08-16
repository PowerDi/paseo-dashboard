import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import {
  ErrorCodes,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
} from "@getpaseo/dashboard-shared";
import { invitations, users, auditEvents } from "../db/schema.js";
import type { Db } from "../db/index.js";
import { requireAuth, hashToken, newToken } from "../lib/auth.js";
import { badRequest, conflict, forbidden } from "../lib/http.js";
import { newId } from "../lib/id.js";

const DEFAULT_EXPIRY_HOURS = 72;
const MAX_EXPIRY_HOURS = 30 * 24;

export function registerInvitationRoutes(app: FastifyInstance, db: Db) {
  const auth = requireAuth(db);

  app.post("/api/v1/invitations", { preHandler: auth }, async (req, rep) => {
    const userId = req.auth!.userId;
    const body = req.body as Partial<CreateInvitationRequest> | undefined;
    const email = body?.email;
    const expiresInHours = body?.expiresInHours ?? DEFAULT_EXPIRY_HOURS;

    const actorRows = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (actorRows[0]?.role !== "admin") return forbidden(rep);

    if (typeof email !== "string" || !email.trim()) return badRequest(rep, "email 为必填");
    const normalized = email.toLowerCase().trim();
    if (
      !Number.isInteger(expiresInHours) ||
      expiresInHours < 1 ||
      expiresInHours > MAX_EXPIRY_HOURS
    ) {
      return badRequest(rep, `expiresInHours 必须是 1-${MAX_EXPIRY_HOURS} 的整数`);
    }

    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.emailNormalized, normalized), isNull(users.deletedAt)))
      .limit(1);
    if (existingUser.length > 0) {
      return conflict(rep, ErrorCodes.EMAIL_EXISTS, "该邮箱已被注册");
    }

    const id = newId("inv");
    const token = newToken();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();

    db.transaction(
      (tx) => {
        tx.update(invitations)
          .set({ revokedAt: now })
          .where(
            and(
              eq(invitations.emailNormalized, normalized),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
            ),
          )
          .run();
        tx.insert(invitations)
          .values({
            id,
            createdByUserId: userId,
            emailNormalized: normalized,
            tokenHash: hashToken(token),
            createdAt: now,
            expiresAt,
          })
          .run();
        tx.insert(auditEvents)
          .values({
            id: newId("aud"),
            userId,
            type: "invitation.created",
            targetType: "invitation",
            targetId: id,
            metadata: JSON.stringify({ expiresAt }),
            createdAt: now,
          })
          .run();
      },
      { behavior: "immediate" },
    );

    rep.code(201).header("Cache-Control", "no-store");
    const response: CreateInvitationResponse = {
      invitation: { id, email: normalized, expiresAt },
      token,
    };
    return response;
  });
}
