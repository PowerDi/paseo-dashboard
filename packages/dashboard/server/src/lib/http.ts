import type { FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { ErrorCodes } from "@getpaseo/dashboard-shared";

export function sendError(
  rep: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return rep.status(status).send({
    error: {
      code,
      message,
      requestId: randomUUID(),
      ...(details ? { details } : {}),
    },
  });
}

export function badRequest(
  rep: FastifyReply,
  message: string,
  details?: Record<string, unknown>,
  code: string = ErrorCodes.VALIDATION,
) {
  return sendError(rep, 400, code, message, details);
}

export function unauthorized(rep: FastifyReply, message = "未授权") {
  return sendError(rep, 401, ErrorCodes.UNAUTHORIZED, message);
}

export function notFound(rep: FastifyReply, message = "资源不存在") {
  return sendError(rep, 404, ErrorCodes.NOT_FOUND, message);
}

export function conflict(
  rep: FastifyReply,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return sendError(rep, 409, code, message, details);
}

export function internal(rep: FastifyReply, message = "服务器内部错误") {
  return sendError(rep, 500, ErrorCodes.INTERNAL, message);
}
