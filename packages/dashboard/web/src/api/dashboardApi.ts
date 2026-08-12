import type {
  Device,
  Host,
  HostImportRequest,
  HostImportResponse,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  Session,
  SyncResponse,
} from "@getpaseo/dashboard-shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Dashboard API failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function register(input: RegisterRequest): Promise<LoginResponse> {
  return request<LoginResponse>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listHosts(): Promise<Host[]> {
  return request<Host[]>("/api/v1/hosts");
}

export function syncHosts(after: number, limit?: number): Promise<SyncResponse> {
  const params = new URLSearchParams({ after: String(after) });
  if (limit !== undefined) params.set("limit", String(limit));
  return request<SyncResponse>(`/api/v1/host-sync?${params.toString()}`);
}

export function importHost(input: HostImportRequest): Promise<HostImportResponse> {
  return request<HostImportResponse>("/api/v1/hosts/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listDevices(): Promise<Device[]> {
  return request<Device[]>("/api/v1/devices");
}

export function revokeDevice(deviceId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/devices/${deviceId}`, { method: "DELETE" });
}

export function listSessions(): Promise<(Session & { isCurrentSession: boolean })[]> {
  return request<(Session & { isCurrentSession: boolean })[]>("/api/v1/sessions");
}

export function revokeSession(sessionId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/sessions/${sessionId}`, { method: "DELETE" });
}
