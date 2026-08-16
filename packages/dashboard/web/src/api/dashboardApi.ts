import type {
  AuditEventListResponse,
  ChangePasswordRequest,
  ConfigEvent,
  Device,
  Host,
  HostImportRequest,
  HostImportResponse,
  HostUpdateRequest,
  LoginRequest,
  LoginResponse,
  Passkey,
  RegisterRequest,
  Session,
  SyncResponse,
  User,
} from "@getpaseo/dashboard-shared";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import {
  createConfigEventStream,
  type ConfigEventStreamOptions,
  type ConfigEventSubscription,
} from "./dashboardEvents";

export interface PasskeyRegistrationOptionsResponse {
  ceremonyId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface PasskeyLoginOptionsResponse {
  ceremonyId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export interface DashboardApiClientOptions {
  /** Prefix for API URLs. Relative paths are used by default. */
  baseUrl?: string;
  /** Optional bearer token for Harmony or a web caller using token auth. */
  accessToken?: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  onUnauthorized?: (error: DashboardApiUnauthorizedError) => void;
}

export interface DashboardRequestOptions extends RequestInit {
  /** Set false for public auth calls such as login with invalid credentials. */
  notifyUnauthorized?: boolean;
}

export class DashboardApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    message = `Dashboard API failed: ${status}`,
    options?: { code?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export class DashboardApiUnauthorizedError extends DashboardApiError {
  constructor(
    message = "Dashboard API failed: 401",
    options?: { code?: string; details?: Record<string, unknown> },
  ) {
    super(401, message, options);
    this.name = "DashboardApiUnauthorizedError";
  }
}

export class DashboardApiClient {
  private readonly baseUrl?: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly credentials: RequestCredentials;
  private accessToken?: string;
  private onUnauthorized?: DashboardApiClientOptions["onUnauthorized"];

  constructor(options: DashboardApiClientOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.credentials = options.credentials ?? "include";
    this.accessToken = options.accessToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  setAccessToken(accessToken: string | undefined): void {
    this.accessToken = accessToken;
  }

  clearAccessToken(): void {
    this.accessToken = undefined;
  }

  setUnauthorizedHandler(handler: DashboardApiClientOptions["onUnauthorized"]): void {
    this.onUnauthorized = handler;
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  async request<T>(path: string, init: DashboardRequestOptions = {}): Promise<T> {
    const { notifyUnauthorized, ...requestInit } = init;
    const headers = new Headers(requestInit.headers);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);

    const response = await this.fetchImpl(this.resolveUrl(path), {
      ...requestInit,
      headers,
      credentials: requestInit.credentials ?? this.credentials,
    });

    if (!response.ok) {
      const error = await apiErrorFromResponse(response);
      if (error.status === 401 && notifyUnauthorized !== false) {
        this.onUnauthorized?.(error as DashboardApiUnauthorizedError);
      }
      throw error;
    }

    return response.json() as Promise<T>;
  }

  register(input: RegisterRequest): Promise<LoginResponse> {
    return this.request<LoginResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
      notifyUnauthorized: false,
    });
  }

  login(input: LoginRequest): Promise<LoginResponse> {
    return this.request<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
      notifyUnauthorized: false,
    });
  }

  beginPasskeyLogin(): Promise<PasskeyLoginOptionsResponse> {
    return this.request<PasskeyLoginOptionsResponse>("/api/v1/auth/passkey/login/options", {
      method: "POST",
      notifyUnauthorized: false,
    });
  }

  finishPasskeyLogin(
    ceremonyId: string,
    response: AuthenticationResponseJSON,
    device: LoginRequest["device"],
  ): Promise<LoginResponse> {
    return this.request<LoginResponse>("/api/v1/auth/passkey/login/verify", {
      method: "POST",
      body: JSON.stringify({ ceremonyId, response, device }),
      notifyUnauthorized: false,
    });
  }

  listHosts(): Promise<Host[]> {
    return this.request<Host[]>("/api/v1/hosts");
  }

  syncHosts(after: number, limit?: number): Promise<SyncResponse> {
    const params = new URLSearchParams({ after: String(after) });
    if (limit !== undefined) params.set("limit", String(limit));
    return this.request<SyncResponse>(`/api/v1/host-sync?${params.toString()}`);
  }

  importHost(input: HostImportRequest): Promise<HostImportResponse> {
    return this.request<HostImportResponse>("/api/v1/hosts/import", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  deleteHost(hostId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/v1/hosts/${encodeURIComponent(hostId)}`, {
      method: "DELETE",
    });
  }

  updateHost(hostId: string, input: HostUpdateRequest): Promise<HostImportResponse> {
    return this.request<HostImportResponse>(`/api/v1/hosts/${encodeURIComponent(hostId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("/api/v1/auth/logout", {
      method: "POST",
      notifyUnauthorized: false,
    });
  }

  getMe(): Promise<{ user: User }> {
    return this.request<{ user: User }>("/api/v1/me");
  }

  changePassword(input: ChangePasswordRequest): Promise<{ expiresIn: number }> {
    return this.request<{ accessToken: string; refreshToken: string; expiresIn: number }>(
      "/api/v1/auth/change-password",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  listPasskeys(): Promise<Passkey[]> {
    return this.request<Passkey[]>("/api/v1/passkeys");
  }

  beginPasskeyRegistration(currentPassword: string): Promise<PasskeyRegistrationOptionsResponse> {
    return this.request<PasskeyRegistrationOptionsResponse>(
      "/api/v1/passkeys/registration/options",
      {
        method: "POST",
        body: JSON.stringify({ currentPassword }),
      },
    );
  }

  finishPasskeyRegistration(
    ceremonyId: string,
    response: RegistrationResponseJSON,
    name: string,
  ): Promise<{ passkey: Passkey }> {
    return this.request<{ passkey: Passkey }>("/api/v1/passkeys/registration/verify", {
      method: "POST",
      body: JSON.stringify({ ceremonyId, response, name }),
    });
  }

  deletePasskey(passkeyId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/v1/passkeys/${encodeURIComponent(passkeyId)}`, {
      method: "DELETE",
    });
  }

  listAuditEvents(cursor?: string, limit?: number): Promise<AuditEventListResponse> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit !== undefined) params.set("limit", String(limit));
    const query = params.toString();
    return this.request<AuditEventListResponse>(`/api/v1/audit-events${query ? `?${query}` : ""}`);
  }

  listDevices(): Promise<Device[]> {
    return this.request<Device[]>("/api/v1/devices");
  }

  revokeDevice(deviceId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    });
  }

  listSessions(): Promise<(Session & { isCurrentSession: boolean })[]> {
    return this.request<(Session & { isCurrentSession: boolean })[]>("/api/v1/sessions");
  }

  revokeSession(sessionId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  subscribeConfigEvents(
    onEvent: (event: ConfigEvent) => void,
    options: Omit<
      ConfigEventStreamOptions,
      "onEvent" | "accessToken" | "fetch" | "credentials" | "url"
    > & {
      url?: string;
    } = {},
  ): ConfigEventSubscription {
    return createConfigEventStream({
      ...options,
      url: this.resolveUrl(options.url ?? "/api/v1/events"),
      accessToken: this.accessToken,
      fetch: this.fetchImpl,
      credentials: this.credentials,
      onUnauthorized: (error) => {
        options.onUnauthorized?.(error);
        this.onUnauthorized?.(new DashboardApiUnauthorizedError(error.message));
      },
      onEvent,
    });
  }

  private resolveUrl(path: string): string {
    if (!this.baseUrl) return path;
    return new URL(path, this.baseUrl).toString();
  }
}

export const dashboardApi = new DashboardApiClient();

export function configureDashboardAuth(
  accessToken: string | undefined,
  onUnauthorized?: (error: DashboardApiUnauthorizedError) => void,
): void {
  dashboardApi.setAccessToken(accessToken);
  dashboardApi.setUnauthorizedHandler(onUnauthorized);
}

export function register(input: RegisterRequest): Promise<LoginResponse> {
  return dashboardApi.register(input);
}

export function login(input: LoginRequest): Promise<LoginResponse> {
  return dashboardApi.login(input);
}

export function beginPasskeyLogin(): Promise<PasskeyLoginOptionsResponse> {
  return dashboardApi.beginPasskeyLogin();
}

export function finishPasskeyLogin(
  ceremonyId: string,
  response: AuthenticationResponseJSON,
  device: LoginRequest["device"],
): Promise<LoginResponse> {
  return dashboardApi.finishPasskeyLogin(ceremonyId, response, device);
}

export function listHosts(): Promise<Host[]> {
  return dashboardApi.listHosts();
}

export function syncHosts(after: number, limit?: number): Promise<SyncResponse> {
  return dashboardApi.syncHosts(after, limit);
}

export function importHost(input: HostImportRequest): Promise<HostImportResponse> {
  return dashboardApi.importHost(input);
}

export function deleteHost(hostId: string): Promise<{ ok: boolean }> {
  return dashboardApi.deleteHost(hostId);
}

export function updateHost(hostId: string, input: HostUpdateRequest): Promise<HostImportResponse> {
  return dashboardApi.updateHost(hostId, input);
}

export function logout(): Promise<{ ok: boolean }> {
  return dashboardApi.logout();
}

export function getMe(): Promise<{ user: User }> {
  return dashboardApi.getMe();
}

export function changePassword(input: ChangePasswordRequest): Promise<{ expiresIn: number }> {
  return dashboardApi.changePassword(input);
}

export function listPasskeys(): Promise<Passkey[]> {
  return dashboardApi.listPasskeys();
}

export function beginPasskeyRegistration(
  currentPassword: string,
): Promise<PasskeyRegistrationOptionsResponse> {
  return dashboardApi.beginPasskeyRegistration(currentPassword);
}

export function finishPasskeyRegistration(
  ceremonyId: string,
  response: RegistrationResponseJSON,
  name: string,
): Promise<{ passkey: Passkey }> {
  return dashboardApi.finishPasskeyRegistration(ceremonyId, response, name);
}

export function deletePasskey(passkeyId: string): Promise<{ ok: boolean }> {
  return dashboardApi.deletePasskey(passkeyId);
}

export function listAuditEvents(cursor?: string, limit?: number): Promise<AuditEventListResponse> {
  return dashboardApi.listAuditEvents(cursor, limit);
}

export function listDevices(): Promise<Device[]> {
  return dashboardApi.listDevices();
}

export function revokeDevice(deviceId: string): Promise<{ ok: boolean }> {
  return dashboardApi.revokeDevice(deviceId);
}

export function listSessions(): Promise<(Session & { isCurrentSession: boolean })[]> {
  return dashboardApi.listSessions();
}

export function revokeSession(sessionId: string): Promise<{ ok: boolean }> {
  return dashboardApi.revokeSession(sessionId);
}

export function subscribeConfigEvents(
  onEvent: (event: ConfigEvent) => void,
  options: Omit<
    ConfigEventStreamOptions,
    "onEvent" | "accessToken" | "fetch" | "credentials" | "url"
  > & {
    url?: string;
  } = {},
): ConfigEventSubscription {
  return dashboardApi.subscribeConfigEvents(onEvent, options);
}

async function apiErrorFromResponse(response: Response): Promise<DashboardApiError> {
  let message = `Dashboard API failed: ${response.status}`;
  let code: string | undefined;
  let details: Record<string, unknown> | undefined;

  try {
    const body = (await response.clone().json()) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };
    message = body.error?.message || message;
    code = body.error?.code;
    details = body.error?.details;
  } catch {
    // Keep the status-based error when the server did not return JSON.
  }

  if (response.status === 401) {
    const error = new DashboardApiUnauthorizedError(message, { code, details });
    return error;
  }
  return new DashboardApiError(response.status, message, { code, details });
}
