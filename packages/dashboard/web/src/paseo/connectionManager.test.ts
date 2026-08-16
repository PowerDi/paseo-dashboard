import type { ConnectionState, DaemonClientConfig } from "@getpaseo/client/internal/daemon-client";
import type { Host } from "@getpaseo/dashboard-shared";
import { describe, expect, test } from "vitest";
import {
  createClientConfig,
  DefaultPaseoConnectionManager,
  type DaemonClientLike,
} from "./connectionManager";

function makeHost(id = "hst_test"): Host {
  return {
    id,
    label: `Host ${id}`,
    version: 1,
    connection: {
      type: "relay",
      serverId: `srv_${id}`,
      relayEndpoint: "relay.paseo.sh:443",
      useTls: true,
      daemonPublicKeyB64: `daemon-public-key-${id}`,
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

class FakeClient implements DaemonClientLike {
  private state: ConnectionState = { status: "idle" };
  private readonly listeners = new Set<(state: ConnectionState) => void>();
  connectCalls = 0;
  closeCalls = 0;

  constructor(
    readonly config: DaemonClientConfig,
    private readonly connectBehavior: (client: FakeClient) => Promise<void> = async (client) => {
      client.emit({ status: "connecting", attempt: 1 });
      client.emit({ status: "connected" });
    },
  ) {}

  connect(): Promise<void> {
    this.connectCalls += 1;
    return this.connectBehavior(this);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.emit({ status: "disposed" });
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLastServerInfoMessage(): null {
    return null;
  }

  on(): () => void {
    return () => undefined;
  }

  async archiveAgent(): Promise<{ archivedAt: string }> {
    return { archivedAt: "2026-08-13T00:00:00.000Z" };
  }

  async cancelAgent(): Promise<void> {}

  fetchAgentTimeline(): never {
    throw new Error("not implemented in fake");
  }

  async setAgentTimelineSubscription(): Promise<void> {}

  sendAgentMessage(): never {
    throw new Error("not implemented in fake");
  }

  createAgent(): never {
    throw new Error("not implemented in fake");
  }

  resumeAgent(): never {
    throw new Error("not implemented in fake");
  }

  async respondToPermission(): Promise<void> {}
  async respondToPermissionAndWait(): Promise<{
    agentId: string;
    requestId: string;
    resolution: { behavior: "allow" };
  }> {
    return { agentId: "", requestId: "", resolution: { behavior: "allow" } };
  }
  async applyAgentConfig(): Promise<null> {
    return null;
  }
  async getProvidersSnapshot(): Promise<{ entries: []; generatedAt: string; requestId: string }> {
    return { entries: [], generatedAt: "", requestId: "" };
  }

  listTerminals(): never {
    throw new Error("not implemented in fake");
  }

  createTerminal(): never {
    throw new Error("not implemented in fake");
  }

  killTerminal(): never {
    throw new Error("not implemented in fake");
  }

  subscribeTerminal(): never {
    throw new Error("not implemented in fake");
  }

  unsubscribeTerminal(): void {}

  sendTerminalInput(): void {}

  onTerminalStreamEvent(): () => void {
    return () => undefined;
  }

  listDirectory(): never {
    throw new Error("not implemented in fake");
  }

  readFile(): never {
    throw new Error("not implemented in fake");
  }

  subscribeFile(): never {
    throw new Error("not implemented in fake");
  }

  emit(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  get connectionListenerCount(): number {
    return this.listeners.size;
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Paseo connection manager", () => {
  test("builds official relay E2EE daemon client config", () => {
    const config = createClientConfig(makeHost());

    expect(config.url).toContain("wss://relay.paseo.sh/ws");
    expect(config.url).toContain("serverId=srv_hst_test");
    expect(config.url).toContain("role=client");
    expect(config.e2ee).toEqual({
      enabled: true,
      daemonPublicKeyB64: "daemon-public-key-hst_test",
    });
    expect(config.clientType).toBe("browser");
    expect(config.reconnect).toEqual({ enabled: true });
  });

  test("keeps pre-connect subscriptions and observes early connection states", async () => {
    const manager = new DefaultPaseoConnectionManager((config) => new FakeClient(config));
    const states: ConnectionState[] = [];

    const unsubscribe = manager.subscribe("hst_test", (state) => states.push(state));
    await manager.connect(makeHost());

    expect(states).toEqual([
      { status: "idle" },
      { status: "connecting", attempt: 1 },
      { status: "connected" },
    ]);

    unsubscribe();
  });

  test("coalesces repeated connects and reuses an established host client", async () => {
    const pending = deferred();
    const clients: FakeClient[] = [];
    const manager = new DefaultPaseoConnectionManager((config) => {
      const client = new FakeClient(config, async (createdClient) => {
        createdClient.emit({ status: "connecting", attempt: 1 });
        await pending.promise;
        createdClient.emit({ status: "connected" });
      });
      clients.push(client);
      return client;
    });

    const firstConnect = manager.connect(makeHost());
    const secondConnect = manager.connect(makeHost());

    expect(clients).toHaveLength(1);
    expect(clients[0]?.connectCalls).toBe(1);
    expect(manager.getState("hst_test")).toEqual({ status: "connecting", attempt: 1 });

    pending.resolve();
    await Promise.all([firstConnect, secondConnect]);
    await manager.connect(makeHost());

    expect(clients[0]?.connectCalls).toBe(1);
    expect(manager.getDaemonClient("hst_test")).toBe(clients[0]);
  });

  test("disconnect rejects an in-flight connect and ignores late client state", async () => {
    const pending = deferred();
    let client!: FakeClient;
    const manager = new DefaultPaseoConnectionManager((config) => {
      client = new FakeClient(config, async (createdClient) => {
        createdClient.emit({ status: "connecting", attempt: 1 });
        await pending.promise;
        createdClient.emit({ status: "connected" });
      });
      return client;
    });
    const states: string[] = [];
    manager.subscribe("hst_test", (state) => states.push(state.status));

    const connectPromise = manager.connect(makeHost());
    await manager.disconnect("hst_test");

    await expect(connectPromise).rejects.toThrow("Connection closed for host hst_test");
    expect(client.closeCalls).toBe(1);
    expect(client.connectionListenerCount).toBe(0);
    expect(manager.getDaemonClient("hst_test")).toBeNull();

    pending.resolve();
    await pending.promise;
    expect(manager.getState("hst_test")).toEqual({ status: "idle" });
    expect(states).toEqual(["idle", "connecting", "idle"]);
  });

  test("removes a failed client and lets the same subscription observe a retry", async () => {
    const clients: FakeClient[] = [];
    const manager = new DefaultPaseoConnectionManager((config) => {
      const client =
        clients.length === 0
          ? new FakeClient(config, async (failedClient) => {
              failedClient.emit({ status: "connecting", attempt: 1 });
              failedClient.emit({ status: "disconnected", reason: "relay unavailable" });
              throw new Error("relay unavailable");
            })
          : new FakeClient(config);
      clients.push(client);
      return client;
    });
    const states: string[] = [];
    const unsubscribe = manager.subscribe("hst_test", (state) => states.push(state.status));

    await expect(manager.connect(makeHost())).rejects.toThrow("relay unavailable");

    expect(manager.getDaemonClient("hst_test")).toBeNull();
    expect(manager.getState("hst_test")).toEqual({ status: "idle" });
    expect(clients[0]?.closeCalls).toBe(1);
    expect(clients[0]?.connectionListenerCount).toBe(0);

    await manager.connect(makeHost());

    expect(clients).toHaveLength(2);
    expect(manager.getDaemonClient("hst_test")).toBe(clients[1]);
    expect(states).toEqual([
      "idle",
      "connecting",
      "disconnected",
      "idle",
      "connecting",
      "connected",
    ]);

    unsubscribe();
  });

  test("disconnect cleans client resources while host subscriptions survive reconnect", async () => {
    const clients: FakeClient[] = [];
    const manager = new DefaultPaseoConnectionManager((config) => {
      const client = new FakeClient(config);
      clients.push(client);
      return client;
    });
    const states: string[] = [];
    const unsubscribe = manager.subscribe("hst_test", (state) => states.push(state.status));

    await manager.connect(makeHost());
    await manager.disconnect("hst_test");

    expect(clients[0]?.closeCalls).toBe(1);
    expect(clients[0]?.connectionListenerCount).toBe(0);
    expect(manager.getDaemonClient("hst_test")).toBeNull();
    expect(manager.getState("hst_test")).toEqual({ status: "idle" });

    await manager.connect(makeHost());
    expect(clients).toHaveLength(2);
    expect(states).toEqual(["idle", "connecting", "connected", "idle", "connecting", "connected"]);

    unsubscribe();
    await manager.disconnect("hst_test");
    expect(states.at(-1)).toBe("connected");
  });

  test("isolates hosts and disconnectAll closes every active client", async () => {
    const clients = new Map<string, FakeClient>();
    const manager = new DefaultPaseoConnectionManager((config) => {
      const hostId = config.clientId.replace("paseo-board-web-", "");
      const client = new FakeClient(config);
      clients.set(hostId, client);
      return client;
    });
    const hostAStates: string[] = [];
    const hostBStates: string[] = [];
    manager.subscribe("hst_a", (state) => hostAStates.push(state.status));
    manager.subscribe("hst_b", (state) => hostBStates.push(state.status));

    await Promise.all([manager.connect(makeHost("hst_a")), manager.connect(makeHost("hst_b"))]);
    await manager.disconnect("hst_a");

    expect(manager.getDaemonClient("hst_a")).toBeNull();
    expect(manager.getState("hst_a")).toEqual({ status: "idle" });
    expect(manager.getDaemonClient("hst_b")).toBe(clients.get("hst_b"));
    expect(manager.getState("hst_b")).toEqual({ status: "connected" });
    expect(hostAStates.at(-1)).toBe("idle");
    expect(hostBStates.at(-1)).toBe("connected");

    await manager.disconnectAll();

    expect(clients.get("hst_a")?.closeCalls).toBe(1);
    expect(clients.get("hst_b")?.closeCalls).toBe(1);
    expect(manager.getDaemonClient("hst_b")).toBeNull();
    expect(manager.getState("hst_b")).toEqual({ status: "idle" });
  });
});
