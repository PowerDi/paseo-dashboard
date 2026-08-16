import type { Host, LoginResponse } from "@getpaseo/dashboard-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardApiError, DashboardApiUnauthorizedError } from "../api/dashboardApi";
import { createAppStore, getDeviceInfo, type AppStoreDependencies } from "./app-store";

const loginResponse: LoginResponse = {
  user: { id: "01USER", email: "user@example.com" },
  deviceId: "01DEVICE",
  expiresIn: 900,
};

function createApiStub(overrides: Partial<NonNullable<AppStoreDependencies["api"]>> = {}) {
  return {
    listHosts: vi.fn(async (): Promise<Host[]> => []),
    getMe: vi.fn(async () => ({ user: loginResponse.user })),
    login: vi.fn(async () => loginResponse),
    beginPasskeyLogin: vi.fn(async () => ({
      ceremonyId: "01CEREMONY",
      options: { challenge: "challenge", rpId: "localhost" },
    })),
    finishPasskeyLogin: vi.fn(async () => loginResponse),
    register: vi.fn(async () => loginResponse),
    logout: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage?.clear();
});

describe("app store bootstrap", () => {
  it("becomes ready when the API accepts the session cookie", async () => {
    const api = createApiStub();
    const onAuthenticated = vi.fn();
    const store = createAppStore({ api, onAuthenticated });

    await store.getState().bootstrap();

    expect(store.getState().status).toBe("ready");
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it("fetches the current user during bootstrap", async () => {
    const api = createApiStub();
    const store = createAppStore({ api });

    await store.getState().bootstrap();

    expect(api.getMe).toHaveBeenCalledOnce();
    expect(store.getState().user?.email).toBe("user@example.com");
  });

  it("becomes unauthenticated on 401", async () => {
    const api = createApiStub({
      listHosts: vi.fn(async () => {
        throw new DashboardApiUnauthorizedError();
      }),
    });
    const store = createAppStore({ api });

    await store.getState().bootstrap();

    expect(store.getState().status).toBe("unauthenticated");
  });

  it("keeps the error retryable on non-auth failures", async () => {
    const api = createApiStub({
      listHosts: vi.fn(async () => {
        throw new DashboardApiError(500, "boom");
      }),
    });
    const store = createAppStore({ api });

    await store.getState().bootstrap();

    expect(store.getState().status).toBe("error");
    expect(store.getState().bootstrapError).toBe("boom");
  });
});

describe("app store auth actions", () => {
  it("stores the user after login and clears it after logout", async () => {
    const api = createApiStub();
    const onLoggedOut = vi.fn();
    const store = createAppStore({ api, onLoggedOut });

    await store.getState().login("user@example.com", "secret123");
    expect(store.getState().status).toBe("ready");
    expect(store.getState().user?.email).toBe("user@example.com");
    expect(api.login).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com", password: "secret123" }),
    );

    await store.getState().logout();
    expect(store.getState().status).toBe("unauthenticated");
    expect(store.getState().user).toBeNull();
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
  });

  it("propagates login failures without changing state", async () => {
    const api = createApiStub({
      login: vi.fn(async () => {
        throw new DashboardApiUnauthorizedError("bad credentials");
      }),
    });
    const store = createAppStore({ api });
    await store.getState().bootstrap();
    // bootstrap succeeded (stub returns hosts), reset to unauthenticated for the scenario
    store.getState().handleUnauthorized();

    await expect(store.getState().login("user@example.com", "wrong")).rejects.toThrow(
      "bad credentials",
    );
    expect(store.getState().status).toBe("unauthenticated");
  });

  it("handleUnauthorized flips ready to unauthenticated once", () => {
    const onLoggedOut = vi.fn();
    const store = createAppStore({ api: createApiStub(), onLoggedOut });
    store.setState({ status: "ready" });

    store.getState().handleUnauthorized();
    store.getState().handleUnauthorized();

    expect(store.getState().status).toBe("unauthenticated");
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
  });
});

describe("device info", () => {
  it("keeps a stable installation id", () => {
    const first = getDeviceInfo();
    const second = getDeviceInfo();
    expect(first.installationId).toBe(second.installationId);
    expect(first.platform).toBe("web");
  });
});

it("signs in through a passkey ceremony", async () => {
  const api = createApiStub();
  const startPasskeyAuthentication = vi.fn(
    async () =>
      ({
        id: "credential",
        rawId: "credential",
        response: {},
        clientExtensionResults: {},
        type: "public-key",
      }) as never,
  );
  const store = createAppStore({ api, startPasskeyAuthentication });

  await store.getState().loginWithPasskey();

  expect(startPasskeyAuthentication).toHaveBeenCalledWith({
    optionsJSON: { challenge: "challenge", rpId: "localhost" },
  });
  expect(api.finishPasskeyLogin).toHaveBeenCalledWith(
    "01CEREMONY",
    expect.anything(),
    expect.objectContaining({ platform: "web" }),
  );
  expect(store.getState().status).toBe("ready");
});
