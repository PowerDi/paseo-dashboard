// API 请求/响应、错误 code 和 Host sync 格式。
// Web、Server、Harmony 共用同一份类型定义。
// 本包不包含页面、数据库、Cookie、平台安全存储或 daemon 连接代码。

// ── 基础类型 ──────────────────────────────────────────

export type Ulid = string;

// ── 错误 ──────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
  };
}

export const ErrorCodes = {
  VALIDATION: "validation_error",
  UNAUTHORIZED: "unauthorized",
  SESSION_EXPIRED: "session_expired",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  HOST_VERSION_CONFLICT: "host_version_conflict",
  RATE_LIMITED: "rate_limited",
  EMAIL_EXISTS: "email_exists",
  INVALID_CREDENTIALS: "invalid_credentials",
  RESET_TOKEN_INVALID: "reset_token_invalid",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict",
  INTERNAL: "internal_error",
} as const;

// ── 认证 ──────────────────────────────────────────────

export interface DeviceInfo {
  installationId: string;
  name: string;
  platform: "web" | "harmony" | "unknown";
}

export interface RegisterRequest {
  email: string;
  password: string;
  device: DeviceInfo;
  inviteToken?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  device: DeviceInfo;
}

export type UserRole = "admin" | "member";

export interface User {
  id: Ulid;
  email: string;
  role?: UserRole;
}

export interface CreateInvitationRequest {
  email: string;
  expiresInHours?: number;
}

export interface CreateInvitationResponse {
  invitation: {
    id: Ulid;
    email: string;
    expiresAt: string;
  };
  token: string;
}

export interface LoginResponse {
  user: User;
  deviceId: Ulid;
  accessToken?: string; // Harmony 使用；Web 用 HttpOnly Cookie
  refreshToken?: string; // Harmony 使用
  expiresIn: number; // accessToken 有效期（秒）
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions: boolean;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

// ── 设备与 Session ────────────────────────────────────

export interface Device {
  id: Ulid;
  displayName: string;
  platform: string;
  firstSeenAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  lastSyncedRevision: number;
  isCurrentDevice: boolean;
}

export interface Session {
  id: Ulid;
  deviceId: Ulid;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

// ── Host ──────────────────────────────────────────────

export type HostConnectionKind = "relay";

export interface HostConnection {
  type: HostConnectionKind;
  serverId: string;
  relayEndpoint: string;
  useTls: boolean;
  daemonPublicKeyB64: string;
}

export interface ClientVerification {
  verifiedAt: string;
  serverVersion: string;
}

export interface HostImportRequest {
  label: string;
  connection: HostConnection;
  clientVerification: ClientVerification;
  idempotencyKey: string;
}

export interface HostUpdateRequest {
  label?: string;
  baseVersion: number; // 乐观并发，冲突→409
}

export interface Host {
  id: Ulid;
  label: string;
  version: number;
  connection: HostConnection;
  createdAt: string;
  updatedAt: string;
}

export interface HostImportResponse {
  host: Host;
  syncRevision: number;
}

// ── 增量同步 ──────────────────────────────────────────

export interface SyncChangeUpsert {
  revision: number;
  operation: "upsert";
  host: Host;
}

export interface SyncChangeDelete {
  revision: number;
  operation: "delete";
  hostId: Ulid;
  deletedAt: string;
}

export type SyncChange = SyncChangeUpsert | SyncChangeDelete;

export interface SyncResponse {
  fromRevision: number;
  toRevision: number;
  changes: SyncChange[];
  hasMore: boolean;
}

// ── 审计 ──────────────────────────────────────────────

export type ConfigEventType =
  | "host.upserted"
  | "host.deleted"
  | "device.revoked"
  | "session.revoked";

export interface ConfigEvent {
  type: ConfigEventType;
  revision: number;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface AuditEvent {
  id: Ulid;
  type: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEventListResponse {
  events: AuditEvent[];
  nextCursor: string | null;
}
