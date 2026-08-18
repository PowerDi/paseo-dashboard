import type {
  Host,
  HostImportRequest,
  HostImportResponse,
  HostUpdateRequest,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  User,
} from "@getpaseo/dashboard-shared";

export interface DashboardApi {
  getMe(): Promise<{ user: User }>;
  register(input: RegisterRequest): Promise<LoginResponse>;
  login(input: LoginRequest): Promise<LoginResponse>;
  logout(): Promise<{ ok: boolean }>;
  listHosts(): Promise<Host[]>;
  importHost(input: HostImportRequest): Promise<HostImportResponse>;
  updateHost(hostId: string, input: HostUpdateRequest): Promise<HostImportResponse>;
  deleteHost(hostId: string): Promise<{ ok: boolean }>;
  setUnauthorizedHandler(handler: DashboardUnauthorizedHandler): void;
}

export type DashboardUnauthorizedHandler = (error: DashboardApiUnauthorizedError) => void;

export interface DashboardApiClientOptions {
  /** Prefix for API URLs. Relative URLs keep local development behind Metro's /api proxy. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
  onUnauthorized?: DashboardUnauthorizedHandler;
}

export interface DashboardRequestOptions extends RequestInit {
  /** Public auth calls and the startup session probe handle 401 themselves. */
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

export class DashboardApiClient implements DashboardApi {
  private readonly baseUrl?: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly credentials: RequestCredentials;
  private onUnauthorized?: DashboardUnauthorizedHandler;

  constructor(options: DashboardApiClientOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.credentials = options.credentials ?? "include";
    this.onUnauthorized = options.onUnauthorized;
  }

  setUnauthorizedHandler(handler: DashboardUnauthorizedHandler): void {
    this.onUnauthorized = handler;
  }

  async request<T>(path: string, init: DashboardRequestOptions = {}): Promise<T> {
    const { notifyUnauthorized, ...requestInit } = init;
    const headers = new Headers(requestInit.headers);
    if (requestInit.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

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

  logout(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("/api/v1/auth/logout", {
      method: "POST",
      notifyUnauthorized: false,
    });
  }

  getMe(): Promise<{ user: User }> {
    // The current Dashboard Server exposes the cookie session probe at /api/v1/me.
    return this.request<{ user: User }>("/api/v1/me", { notifyUnauthorized: false });
  }

  listHosts(): Promise<Host[]> {
    return this.request<Host[]>("/api/v1/hosts");
  }

  importHost(input: HostImportRequest): Promise<HostImportResponse> {
    return this.request<HostImportResponse>("/api/v1/hosts/import", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateHost(hostId: string, input: HostUpdateRequest): Promise<HostImportResponse> {
    return this.request<HostImportResponse>(`/api/v1/hosts/${encodeURIComponent(hostId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteHost(hostId: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/api/v1/hosts/${encodeURIComponent(hostId)}`, {
      method: "DELETE",
    });
  }

  private resolveUrl(path: string): string {
    if (!this.baseUrl) return path;
    return new URL(path, this.baseUrl).toString();
  }
}

export const dashboardApi = new DashboardApiClient();

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
    return new DashboardApiUnauthorizedError(message, { code, details });
  }
  return new DashboardApiError(response.status, message, { code, details });
}
