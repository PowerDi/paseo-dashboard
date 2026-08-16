import type { DeviceInfo, User } from "@getpaseo/dashboard-shared";
import { startAuthentication } from "@simplewebauthn/browser";
import { create } from "zustand";
import {
  DashboardApiUnauthorizedError,
  dashboardApi,
  type DashboardApiClient,
} from "../api/dashboardApi";
import { dashboardRuntime } from "../paseo/dashboardRuntime";
import { useHostSyncStore } from "./host-sync-store";

/**
 * Auth / bootstrap state machine.
 *
 * Web auth uses HttpOnly cookies, so there is no token to inspect locally.
 * `bootstrap()` probes the API with `listHosts()`: 200 → ready, 401 →
 * unauthenticated, anything else → error (retryable). The user object is
 * only available from login/register responses, so it is cached in
 * localStorage for display across reloads.
 */

const INSTALLATION_ID_KEY = "paseo-dashboard:installation-id";
const USER_KEY = "paseo-dashboard:user";

export type AppAuthStatus = "checking" | "unauthenticated" | "ready" | "error";

export interface AppState {
  status: AppAuthStatus;
  user: User | null;
  bootstrapError: string | null;

  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Called by the API layer when any authenticated request returns 401. */
  handleUnauthorized: () => void;
}

export interface AppStoreDependencies {
  api?: Pick<
    DashboardApiClient,
    | "listHosts"
    | "getMe"
    | "login"
    | "beginPasskeyLogin"
    | "finishPasskeyLogin"
    | "register"
    | "logout"
  >;
  startPasskeyAuthentication?: typeof startAuthentication;
  /** Runs after login/bootstrap succeed and after logout, in that order. */
  onAuthenticated?: () => void;
  onLoggedOut?: () => void;
}

function readStoredUser(): User | null {
  try {
    const raw = globalThis.localStorage?.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    if (typeof parsed?.id === "string" && typeof parsed?.email === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

function storeUser(user: User | null): void {
  try {
    if (user) globalThis.localStorage?.setItem(USER_KEY, JSON.stringify(user));
    else globalThis.localStorage?.removeItem(USER_KEY);
  } catch {
    // localStorage may be unavailable
  }
}

// In-memory fallback keeps the id stable within a session when localStorage
// is unavailable (private browsing, tests).
let fallbackInstallationId: string | null = null;

export function getDeviceInfo(): DeviceInfo {
  let installationId: string | null = null;
  try {
    installationId = globalThis.localStorage?.getItem(INSTALLATION_ID_KEY) ?? null;
    if (!installationId) {
      installationId = fallbackInstallationId ?? crypto.randomUUID();
      globalThis.localStorage?.setItem(INSTALLATION_ID_KEY, installationId);
    }
  } catch {
    installationId = fallbackInstallationId ?? crypto.randomUUID();
  }
  fallbackInstallationId = installationId;

  return {
    installationId,
    name: describeBrowser(),
    platform: "web",
  };
}

function describeBrowser(): string {
  const ua = globalThis.navigator?.userAgent ?? "";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/")) return "Safari";
  return "Browser";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAppStore(dependencies: AppStoreDependencies = {}) {
  const api = dependencies.api ?? dashboardApi;

  return create<AppState>((set, get) => ({
    status: "checking",
    user: readStoredUser(),
    bootstrapError: null,

    bootstrap: async () => {
      set({ status: "checking", bootstrapError: null });
      try {
        const [me] = await Promise.all([api.getMe(), api.listHosts()]);
        storeUser(me.user);
        set({ status: "ready", user: me.user });
        dependencies.onAuthenticated?.();
      } catch (error) {
        if (error instanceof DashboardApiUnauthorizedError) {
          set({ status: "unauthenticated" });
          return;
        }
        set({ status: "error", bootstrapError: errorText(error) });
      }
    },

    login: async (email, password) => {
      const response = await api.login({ email, password, device: getDeviceInfo() });
      storeUser(response.user);
      set({ status: "ready", user: response.user, bootstrapError: null });
      dependencies.onAuthenticated?.();
    },

    loginWithPasskey: async () => {
      const ceremony = await api.beginPasskeyLogin();
      const response = await (dependencies.startPasskeyAuthentication ?? startAuthentication)({
        optionsJSON: ceremony.options,
      });
      const loginResponse = await api.finishPasskeyLogin(
        ceremony.ceremonyId,
        response,
        getDeviceInfo(),
      );
      storeUser(loginResponse.user);
      set({ status: "ready", user: loginResponse.user, bootstrapError: null });
      dependencies.onAuthenticated?.();
    },

    register: async (email, password) => {
      const response = await api.register({ email, password, device: getDeviceInfo() });
      storeUser(response.user);
      set({ status: "ready", user: response.user, bootstrapError: null });
      dependencies.onAuthenticated?.();
    },

    logout: async () => {
      try {
        await api.logout();
      } catch {
        // Best effort: local state is cleared either way.
      }
      storeUser(null);
      set({ status: "unauthenticated", user: null });
      dependencies.onLoggedOut?.();
    },

    handleUnauthorized: () => {
      if (get().status !== "ready" && get().status !== "checking") return;
      storeUser(null);
      set({ status: "unauthenticated", user: null });
      dependencies.onLoggedOut?.();
    },
  }));
}

export const useAppStore = createAppStore({
  onAuthenticated: () => {
    useHostSyncStore.getState().init();
    void useHostSyncStore.getState().sync();
  },
  onLoggedOut: () => {
    void dashboardRuntime.disconnectAll().catch(() => undefined);
    useHostSyncStore.getState().clear();
  },
});

dashboardApi.setUnauthorizedHandler(() => useAppStore.getState().handleUnauthorized());
