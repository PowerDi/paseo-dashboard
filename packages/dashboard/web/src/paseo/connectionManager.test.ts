import { describe, expect, test } from "vitest";
import type { ConnectionState, DaemonClientConfig } from "@getpaseo/client/internal/daemon-client";
import type { Host } from "@getpaseo/dashboard-shared";
import {
  createClientConfig,
  DefaultPaseoConnectionManager,
  type DaemonClientLike,
} from "./connectionManager";

function makeHost(): Host {
  return {
    id: "hst_test",
    label: "Test Host",
    version: 1,
    connection: {
      type: "relay",
      serverId: "srv_test",
      relayEndpoint: "relay.paseo.sh:443",
      useTls: true,
      daemonPublicKeyB64: "daemon-public-key",
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

class FakeClient implements DaemonClientLike {
  private state: ConnectionState = { status: "idle" };
  private readonly listeners = new Set<(state: ConnectionState) => void>();

  constructor(readonly config: DaemonClientConfig) {}

  async connect(): Promise<void> {
    this.setState({ status: "connected" });
  }

  async close(): Promise<void> {
    this.setState({ status: "disposed" });
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

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

describe("Paseo connection manager", () => {
  test("builds official relay E2EE daemon client config", () => {
    const config = createClientConfig(makeHost());

    expect(config.url).toContain("wss://relay.paseo.sh/ws");
    expect(config.url).toContain("serverId=srv_test");
    expect(config.url).toContain("role=client");
    expect(config.e2ee).toEqual({ enabled: true, daemonPublicKeyB64: "daemon-public-key" });
    expect(config.clientType).toBe("browser");
  });

  test("tracks client connection state per host", async () => {
    const manager = new DefaultPaseoConnectionManager((config) => new FakeClient(config));
    const states: string[] = [];

    const unsubscribe = manager.subscribe("hst_test", (state) => states.push(state.status));
    await manager.connect(makeHost());
    const client = manager.getDaemonClient("hst_test");

    expect(client).toBeTruthy();
    expect(manager.getState("hst_test").status).toBe("connected");

    await manager.disconnect("hst_test");
    unsubscribe();

    expect(states).toContain("idle");
    expect(manager.getState("hst_test").status).toBe("idle");
  });
});
