import type {
  DeviceInfo,
  Host,
  HostImportRequest,
  HostImportResponse,
  HostUpdateRequest,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  User,
} from "@getpaseo/dashboard-shared";
import { describe, expect, it, vi } from "vitest";
import {
  type DashboardApi,
  DashboardApiUnauthorizedError,
  type DashboardUnauthorizedHandler,
} from "./api-client";
import { DashboardAuthenticationRequiredError, createDashboardSessionStore } from "./session-store";

const USER: User = { id: "usr_1", email: "user@example.com" };
const DEVICE: DeviceInfo = { installationId: "install_1", name: "Browser", platform: "web" };
const HOST: Host = {
  id: "host_1",
  label: "Workstation",
  version: 1,
  connection: {
    type: "relay",
    serverId: "server_1",
    relayEndpoint: "relay.paseo.sh:443",
    useTls: true,
    daemonPublicKeyB64: "public-key",
  },
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

interface FakeDashboardApi extends DashboardApi {
  getMe: ReturnType<typeof vi.fn<() => Promise<{ user: User }>>>;
  register: ReturnType<typeof vi.fn<(input: RegisterRequest) => Promise<LoginResponse>>>;
  login: ReturnType<typeof vi.fn<(input: LoginRequest) => Promise<LoginResponse>>>;
  logout: ReturnType<typeof vi.fn<() => Promise<{ ok: boolean }>>>;
  listHosts: ReturnType<typeof vi.fn<() => Promise<Host[]>>>;
  importHost: ReturnType<typeof vi.fn<(input: HostImportRequest) => Promise<HostImportResponse>>>;
  updateHost: ReturnType<
    typeof vi.fn<(hostId: string, input: HostUpdateRequest) => Promise<HostImportResponse>>
  >;
  deleteHost: ReturnType<typeof vi.fn<(hostId: string) => Promise<{ ok: boolean }>>>;
  unauthorizedHandler: DashboardUnauthorizedHandler | null;
}

function createFakeApi(): FakeDashboardApi {
  const api: FakeDashboardApi = {
    getMe: vi.fn(async () => ({ user: USER })),
    register: vi.fn(async () => ({ user: USER, deviceId: "dev_1", expiresIn: 900 })),
    login: vi.fn(async () => ({ user: USER, deviceId: "dev_1", expiresIn: 900 })),
    logout: vi.fn(async () => ({ ok: true })),
    listHosts: vi.fn(async () => [HOST]),
    importHost: vi.fn(async () => ({ host: HOST, syncRevision: 1 })),
    updateHost: vi.fn(async (_hostId: string, _input: HostUpdateRequest) => ({
      host: { ...HOST, label: "Renamed Workstation", version: 2 },
      syncRevision: 2,
    })),
    deleteHost: vi.fn(async () => ({ ok: true })),
    unauthorizedHandler: null,
    setUnauthorizedHandler(handler) {
      this.unauthorizedHandler = handler;
    },
  };
  return api;
}

describe("DashboardSessionStore", () => {
  it("boots with only the session probe when the browser is not logged in", async () => {
    const api = createFakeApi();
    api.getMe.mockRejectedValueOnce(new DashboardApiUnauthorizedError("not signed in"));
    const store = createDashboardSessionStore({ api, getDeviceInfo: () => DEVICE });

    await store.bootstrap();

    expect(api.getMe).toHaveBeenCalledOnce();
    expect(api.listHosts).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({
      authStatus: "anonymous",
      user: null,
      hosts: [],
      hostsStatus: "idle",
    });
  });

  it("loads account Hosts only after the session probe succeeds", async () => {
    const api = createFakeApi();
    const calls: string[] = [];
    api.getMe.mockImplementationOnce(async () => {
      calls.push("me");
      return { user: USER };
    });
    api.listHosts.mockImplementationOnce(async () => {
      calls.push("hosts");
      return [HOST];
    });
    const store = createDashboardSessionStore({ api, getDeviceInfo: () => DEVICE });

    await store.bootstrap();

    expect(calls).toEqual(["me", "hosts"]);
    expect(store.getSnapshot()).toMatchObject({
      authStatus: "authenticated",
      user: USER,
      hosts: [HOST],
      hostsStatus: "ready",
    });
  });

  it("loads Hosts after login and sends the Dashboard Web device identity", async () => {
    const api = createFakeApi();
    const store = createDashboardSessionStore({ api, getDeviceInfo: () => DEVICE });

    await store.login(" user@example.com ", "password");

    expect(api.login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password",
      device: DEVICE,
    });
    expect(api.listHosts).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({
      authStatus: "authenticated",
      hosts: [HOST],
    });
  });

  it("never refreshes or imports Hosts before authentication", async () => {
    const api = createFakeApi();
    api.getMe.mockRejectedValueOnce(new DashboardApiUnauthorizedError("not signed in"));
    const store = createDashboardSessionStore({ api, getDeviceInfo: () => DEVICE });
    await store.bootstrap();

    await expect(store.refreshHosts()).resolves.toEqual([]);
    await expect(
      store.importHost({
        label: "Workstation",
        connection: HOST.connection,
        clientVerification: {
          verifiedAt: "2026-08-18T00:00:00.000Z",
          serverVersion: "0.4.0",
        },
        idempotencyKey: "pair_1",
      }),
    ).rejects.toBeInstanceOf(DashboardAuthenticationRequiredError);

    expect(api.listHosts).not.toHaveBeenCalled();
    expect(api.importHost).not.toHaveBeenCalled();
  });

  it("adds an imported Host to the account-backed snapshot", async () => {
    const api = createFakeApi();
    api.listHosts.mockResolvedValueOnce([]);
    const store = createDashboardSessionStore({ api, getDeviceInfo: () => DEVICE });
    await store.login("user@example.com", "password");

    const imported = await store.importHost({
      label: HOST.label,
      connection: HOST.connection,
      clientVerification: {
        verifiedAt: "2026-08-18T00:00:00.000Z",
        serverVersion: "0.4.0",
      },
      idempotencyKey: "pair_1",
    });

    expect(imported).toEqual(HOST);
    expect(store.getSnapshot().hosts).toEqual([HOST]);
  });

  it("updates or deletes the snapshot only after the server confirms the change", async () => {
    const api = createFakeApi();
    const store = createDashboardSessionStore({ api, getDeviceInfo: () => DEVICE });
    await store.bootstrap();

    api.updateHost.mockRejectedValueOnce(new Error("rename failed"));
    await expect(
      store.updateHost("host_1", { label: "Renamed Workstation", baseVersion: 1 }),
    ).rejects.toThrow("rename failed");
    expect(store.getSnapshot().hosts).toEqual([HOST]);

    const renamed = await store.updateHost("host_1", {
      label: "Renamed Workstation",
      baseVersion: 1,
    });
    expect(renamed.label).toBe("Renamed Workstation");
    expect(store.getSnapshot().hosts[0]?.label).toBe("Renamed Workstation");

    api.deleteHost.mockRejectedValueOnce(new Error("delete failed"));
    await expect(store.deleteHost("host_1")).rejects.toThrow("delete failed");
    expect(store.getSnapshot().hosts).toHaveLength(1);

    await store.deleteHost("host_1");
    expect(store.getSnapshot().hosts).toEqual([]);
  });

  it("can replace the account Host snapshot for a runtime refresh", async () => {
    const api = createFakeApi();
    const store = createDashboardSessionStore({ api, getDeviceInfo: () => DEVICE });
    await store.bootstrap();

    const replacement = { ...HOST, id: "host_2", label: "Second Workstation" };
    store.replaceHostsSnapshot([replacement]);

    expect(store.getSnapshot().hosts).toEqual([replacement]);
    expect(store.getSnapshot().hostsStatus).toBe("ready");
  });

  it("clears account Hosts when an authenticated API call reports 401", async () => {
    const api = createFakeApi();
    const store = createDashboardSessionStore({ api, getDeviceInfo: () => DEVICE });
    await store.bootstrap();

    api.unauthorizedHandler?.(new DashboardApiUnauthorizedError("expired"));

    expect(store.getSnapshot()).toMatchObject({
      authStatus: "anonymous",
      user: null,
      hosts: [],
    });
  });
});
