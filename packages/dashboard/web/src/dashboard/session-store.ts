import type {
  DeviceInfo,
  Host,
  HostImportRequest,
  HostUpdateRequest,
  LoginResponse,
  User,
} from "@getpaseo/dashboard-shared";
import { DashboardApiUnauthorizedError, dashboardApi, type DashboardApi } from "./api-client";
import { getDashboardDeviceInfo } from "./device";

export type DashboardAuthStatus = "checking" | "anonymous" | "authenticated" | "error";
export type DashboardHostsStatus = "idle" | "loading" | "ready" | "error";
export type DashboardAuthAction = "login" | "register" | "logout" | null;

export interface DashboardSessionSnapshot {
  authStatus: DashboardAuthStatus;
  authAction: DashboardAuthAction;
  user: User | null;
  hosts: Host[];
  hostsStatus: DashboardHostsStatus;
  authError: string | null;
  hostsError: string | null;
}

export interface DashboardSessionStoreOptions {
  api?: DashboardApi;
  getDeviceInfo?: () => DeviceInfo | Promise<DeviceInfo>;
}

export class DashboardAuthenticationRequiredError extends Error {
  constructor() {
    super("请先登录 Dashboard");
    this.name = "DashboardAuthenticationRequiredError";
  }
}

const INITIAL_SNAPSHOT: DashboardSessionSnapshot = {
  authStatus: "checking",
  authAction: null,
  user: null,
  hosts: [],
  hostsStatus: "idle",
  authError: null,
  hostsError: null,
};

export class DashboardSessionStore {
  private readonly api: DashboardApi;
  private readonly getDeviceInfo: () => DeviceInfo | Promise<DeviceInfo>;
  private readonly listeners = new Set<() => void>();
  private snapshot: DashboardSessionSnapshot = INITIAL_SNAPSHOT;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(options: DashboardSessionStoreOptions = {}) {
    this.api = options.api ?? dashboardApi;
    this.getDeviceInfo = options.getDeviceInfo ?? getDashboardDeviceInfo;
    this.api.setUnauthorizedHandler(() => this.handleUnauthorized());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DashboardSessionSnapshot => this.snapshot;

  bootstrap = (): Promise<void> => {
    if (this.bootstrapPromise) return this.bootstrapPromise;
    this.bootstrapPromise = this.runBootstrap().finally(() => {
      this.bootstrapPromise = null;
    });
    return this.bootstrapPromise;
  };

  login = async (email: string, password: string): Promise<void> => {
    await this.authenticate("login", email, password);
  };

  register = async (email: string, password: string): Promise<void> => {
    await this.authenticate("register", email, password);
  };

  logout = async (): Promise<void> => {
    this.patch({ authAction: "logout", authError: null });
    try {
      await this.api.logout();
    } catch {
      // The cookie may already be invalid. Local account state is cleared either way.
    } finally {
      this.becomeAnonymous();
    }
  };

  refreshHosts = async (): Promise<Host[]> => {
    if (this.snapshot.authStatus !== "authenticated") {
      return [];
    }

    this.patch({ hostsStatus: "loading", hostsError: null });
    try {
      const hosts = await this.api.listHosts();
      if (this.snapshot.authStatus !== "authenticated") return [];
      this.patch({ hosts, hostsStatus: "ready", hostsError: null });
      return hosts;
    } catch (error) {
      if (this.snapshot.authStatus === "authenticated") {
        this.patch({ hostsStatus: "error", hostsError: errorText(error) });
      }
      throw error;
    }
  };

  importHost = async (input: HostImportRequest): Promise<Host> => {
    this.requireAuthenticated();
    const response = await this.api.importHost(input);
    this.requireAuthenticated();

    this.upsertHostSnapshot(response.host);
    return response.host;
  };

  updateHost = async (hostId: string, input: HostUpdateRequest): Promise<Host> => {
    this.requireAuthenticated();
    const response = await this.api.updateHost(hostId, input);
    this.requireAuthenticated();

    this.upsertHostSnapshot(response.host);
    return response.host;
  };

  deleteHost = async (hostId: string): Promise<void> => {
    this.requireAuthenticated();
    const response = await this.api.deleteHost(hostId);
    this.requireAuthenticated();
    if (!response.ok) throw new Error("Dashboard 未确认删除 Host");

    this.patch({
      hosts: this.snapshot.hosts.filter((host) => host.id !== hostId),
      hostsStatus: "ready",
      hostsError: null,
    });
  };

  replaceHostsSnapshot = (hosts: Host[]): void => {
    this.requireAuthenticated();
    this.patch({ hosts: [...hosts], hostsStatus: "ready", hostsError: null });
  };

  clearAuthError = (): void => {
    if (this.snapshot.authError) this.patch({ authError: null });
  };

  private runBootstrap = async (): Promise<void> => {
    this.replace({ ...INITIAL_SNAPSHOT });

    let user: User;
    try {
      const response = await this.api.getMe();
      user = response.user;
    } catch (error) {
      if (error instanceof DashboardApiUnauthorizedError) {
        this.becomeAnonymous();
        return;
      }
      this.patch({ authStatus: "error", authError: errorText(error) });
      return;
    }

    this.becomeAuthenticated(user);
    try {
      await this.refreshHosts();
    } catch {
      // Authentication succeeded. Keep the signed-in shell available so Host loading can be retried.
    }
  };

  private authenticate = async (
    action: Exclude<DashboardAuthAction, "logout" | null>,
    email: string,
    password: string,
  ): Promise<void> => {
    this.patch({ authAction: action, authError: null });
    try {
      const device = await this.getDeviceInfo();
      const response = await this.callAuthEndpoint(action, email.trim(), password, device);
      this.becomeAuthenticated(response.user);
      try {
        await this.refreshHosts();
      } catch {
        // A valid login is not undone by a temporary Host-list failure.
      }
    } catch (error) {
      if (this.snapshot.authStatus !== "authenticated") {
        this.patch({ authStatus: "anonymous", authAction: null, authError: errorText(error) });
      }
      throw error;
    }
  };

  private callAuthEndpoint(
    action: Exclude<DashboardAuthAction, "logout" | null>,
    email: string,
    password: string,
    device: DeviceInfo,
  ): Promise<LoginResponse> {
    const input = { email, password, device };
    return action === "login" ? this.api.login(input) : this.api.register(input);
  }

  private upsertHostSnapshot(host: Host): void {
    this.patch({
      hosts: upsertHost(this.snapshot.hosts, host),
      hostsStatus: "ready",
      hostsError: null,
    });
  }

  private handleUnauthorized = (): void => {
    if (this.snapshot.authStatus === "anonymous") return;
    this.becomeAnonymous();
  };

  private requireAuthenticated(): void {
    if (this.snapshot.authStatus !== "authenticated") {
      throw new DashboardAuthenticationRequiredError();
    }
  }

  private becomeAuthenticated(user: User): void {
    this.replace({
      authStatus: "authenticated",
      authAction: null,
      user,
      hosts: [],
      hostsStatus: "idle",
      authError: null,
      hostsError: null,
    });
  }

  private becomeAnonymous(): void {
    this.replace({
      authStatus: "anonymous",
      authAction: null,
      user: null,
      hosts: [],
      hostsStatus: "idle",
      authError: null,
      hostsError: null,
    });
  }

  private patch(next: Partial<DashboardSessionSnapshot>): void {
    this.replace({ ...this.snapshot, ...next });
  }

  private replace(next: DashboardSessionSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function createDashboardSessionStore(
  options: DashboardSessionStoreOptions = {},
): DashboardSessionStore {
  return new DashboardSessionStore(options);
}

export const dashboardSessionStore = createDashboardSessionStore();

function upsertHost(hosts: Host[], nextHost: Host): Host[] {
  const withoutPrevious = hosts.filter((host) => host.id !== nextHost.id);
  return [...withoutPrevious, nextHost].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
