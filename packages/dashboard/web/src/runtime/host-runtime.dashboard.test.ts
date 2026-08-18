import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  process.env.EXPO_OS = "web";
});
import type { ConnectionState, DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { defaultHostAppearance } from "../hosts/appearance";
import type { HostConnection, HostProfile } from "../types/host-connection";
import {
  HostRuntimeStore,
  type HostRuntimeControllerDeps,
  type HostRuntimeStorage,
} from "./host-runtime";

const REGISTRY_STORAGE_KEY = "@paseo:daemon-registry";
const DASHBOARD_DIRECT_CONNECTION_ERROR =
  "Direct Host connections are unavailable in Dashboard mode.";

function relayHost(serverId: string): HostProfile {
  const connection: HostConnection = {
    id: `relay:${serverId}`,
    type: "relay",
    relayEndpoint: "relay.paseo.sh:443",
    useTls: true,
    daemonPublicKeyB64: `pk_${serverId}`,
  };
  return {
    serverId,
    label: serverId,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [connection],
    preferredConnectionId: connection.id,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function dashboardStorage(): HostRuntimeStorage & {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
} {
  return {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
  };
}

function disconnectedClient() {
  const close = vi.fn(async () => undefined);
  const client = {
    lastError: null,
    close,
    connect: vi.fn(async () => undefined),
    getLastLivenessRttMs: vi.fn(() => null),
    measureLatency: vi.fn(async () => 5),
    setReconnectEnabled: vi.fn(),
    subscribeConnectionStatus: vi.fn((listener: (state: ConnectionState) => void) => {
      listener({ status: "idle" });
      return () => undefined;
    }),
  } as unknown as DaemonClient;
  return { client, close };
}

function dashboardDeps(input?: {
  clients?: Map<string, ReturnType<typeof disconnectedClient>>;
  readInitialConnectionHint?: HostRuntimeControllerDeps["readInitialConnectionHint"];
}): HostRuntimeControllerDeps {
  return {
    createClient: () => {
      throw new Error("createClient should not be called for an adopted probe client");
    },
    connectToDaemon: vi.fn(async ({ host }) => {
      const ownedClient = disconnectedClient();
      input?.clients?.set(host.serverId, ownedClient);
      return {
        client: ownedClient.client,
        serverId: host.serverId,
        hostname: host.label,
      };
    }),
    getClientId: async () => "cid_dashboard_runtime",
    ...(input?.readInitialConnectionHint
      ? { readInitialConnectionHint: input.readInitialConnectionHint }
      : {}),
  };
}

describe("HostRuntimeStore Dashboard boundary", () => {
  it("boots without reading local registries or probing local connection sources", async () => {
    const previousDashboardMode = process.env.EXPO_PUBLIC_PASEO_DASHBOARD;
    const previousOverride = process.env.EXPO_PUBLIC_LOCAL_DAEMON;
    process.env.EXPO_PUBLIC_PASEO_DASHBOARD = "1";
    process.env.EXPO_PUBLIC_LOCAL_DAEMON = "override-host:6767";

    try {
      const storage = dashboardStorage();
      const readInitialConnectionHint = vi.fn(() => ({
        listen: "initial-host:6767",
        useTls: false,
      }));
      const deps = dashboardDeps({ readInitialConnectionHint });
      const store = new HostRuntimeStore({ storage, deps });

      await store.boot();

      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(readInitialConnectionHint).not.toHaveBeenCalled();
      expect(deps.connectToDaemon).not.toHaveBeenCalled();
      expect(store.getHosts()).toEqual([]);
      expect(store.getHostRegistryStatus()).toBe("ready");
      expect(store.isHostRegistryLoaded()).toBe(true);
    } finally {
      if (previousDashboardMode === undefined) {
        delete process.env.EXPO_PUBLIC_PASEO_DASHBOARD;
      } else {
        process.env.EXPO_PUBLIC_PASEO_DASHBOARD = previousDashboardMode;
      }
      if (previousOverride === undefined) {
        delete process.env.EXPO_PUBLIC_LOCAL_DAEMON;
      } else {
        process.env.EXPO_PUBLIC_LOCAL_DAEMON = previousOverride;
      }
    }
  });

  it("replaces account hosts and clears their controllers on logout without registry writes", async () => {
    const storage = dashboardStorage();
    const clients = new Map<string, ReturnType<typeof disconnectedClient>>();
    const store = new HostRuntimeStore({
      dashboardMode: true,
      storage,
      deps: dashboardDeps({ clients }),
    });
    await store.boot();

    store.replaceDashboardAccountHosts([relayHost("account-a")]);
    await vi.waitFor(() => expect(store.getClient("account-a")).not.toBeNull());

    store.replaceDashboardAccountHosts([relayHost("account-b")]);
    await vi.waitFor(() => expect(store.getClient("account-b")).not.toBeNull());
    await vi.waitFor(() => expect(clients.get("account-a")?.close).toHaveBeenCalledOnce());

    expect(store.getHosts().map((host) => host.serverId)).toEqual(["account-b"]);
    expect(store.getSnapshot("account-a")).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalledWith(REGISTRY_STORAGE_KEY, expect.any(String));

    await store.clearDashboardAccountHosts();

    expect(store.getHosts()).toEqual([]);
    expect(store.getSnapshot("account-b")).toBeNull();
    expect(clients.get("account-b")?.close).toHaveBeenCalledOnce();
    expect(storage.setItem).not.toHaveBeenCalledWith(REGISTRY_STORAGE_KEY, expect.any(String));
  });

  it("rejects every public direct-connection entry point", async () => {
    const deps = dashboardDeps();
    const store = new HostRuntimeStore({
      dashboardMode: true,
      storage: dashboardStorage(),
      deps,
    });

    await expect(
      store.upsertDirectConnection({ serverId: "direct", endpoint: "localhost:6767" }),
    ).rejects.toThrow(DASHBOARD_DIRECT_CONNECTION_ERROR);
    await expect(
      store.probeAndUpsertDirectConnection({ endpoint: "localhost:6767" }),
    ).rejects.toThrow(DASHBOARD_DIRECT_CONNECTION_ERROR);
    await expect(
      store.probeAndUpsertConnection({
        connection: {
          id: "direct:localhost:6767",
          type: "directTcp",
          endpoint: "localhost:6767",
        },
      }),
    ).rejects.toThrow(DASHBOARD_DIRECT_CONNECTION_ERROR);
    await expect(
      store.upsertConnectionFromListen({
        listenAddress: "localhost:6767",
        serverId: "direct",
        hostname: "local",
      }),
    ).rejects.toThrow(DASHBOARD_DIRECT_CONNECTION_ERROR);

    expect(deps.connectToDaemon).not.toHaveBeenCalled();
  });
});
