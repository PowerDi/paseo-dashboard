import {
  DaemonClient,
  type ConnectionState,
  type DaemonClientConfig,
} from "@getpaseo/client/internal/daemon-client";
import {
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import type { Host } from "@getpaseo/dashboard-shared";

export type HostConnectionState = ConnectionState;
export type DaemonClientLike = Pick<
  DaemonClient,
  | "connect"
  | "close"
  | "getConnectionState"
  | "subscribeConnectionStatus"
  | "getLastServerInfoMessage"
>;
export type DaemonClientFactory = (config: DaemonClientConfig) => DaemonClientLike;
export type PaseoConnectionListener = (state: HostConnectionState) => void;

interface ManagedConnection {
  client: DaemonClientLike;
  state: HostConnectionState;
  unsubscribeClient: () => void;
  listeners: Set<PaseoConnectionListener>;
}

export interface PaseoConnectionManager {
  connect(host: Host): Promise<void>;
  disconnect(hostId: string): Promise<void>;
  getState(hostId: string): HostConnectionState;
  subscribe(hostId: string, listener: PaseoConnectionListener): () => void;
  getDaemonClient(hostId: string): DaemonClientLike | null;
}

export class DefaultPaseoConnectionManager implements PaseoConnectionManager {
  private readonly connections = new Map<string, ManagedConnection>();

  constructor(
    private readonly createClient: DaemonClientFactory = (config) => new DaemonClient(config),
  ) {}

  async connect(host: Host): Promise<void> {
    const existing = this.connections.get(host.id);
    if (existing && existing.state.status !== "disposed") {
      await existing.client.connect();
      return;
    }

    const client = this.createClient(createClientConfig(host));
    const managed: ManagedConnection = {
      client,
      state: client.getConnectionState(),
      unsubscribeClient: () => undefined,
      listeners: new Set(),
    };

    managed.unsubscribeClient = client.subscribeConnectionStatus((state) => {
      managed.state = state;
      for (const listener of managed.listeners) {
        listener(state);
      }
    });

    this.connections.set(host.id, managed);

    try {
      await client.connect();
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  async disconnect(hostId: string): Promise<void> {
    const managed = this.connections.get(hostId);
    if (!managed) return;
    managed.unsubscribeClient();
    await managed.client.close();
    this.connections.delete(hostId);
  }

  getState(hostId: string): HostConnectionState {
    return this.connections.get(hostId)?.state ?? { status: "idle" };
  }

  subscribe(hostId: string, listener: PaseoConnectionListener): () => void {
    const managed = this.connections.get(hostId);
    if (!managed) {
      listener({ status: "idle" });
      return () => undefined;
    }

    managed.listeners.add(listener);
    listener(managed.state);
    return () => {
      managed.listeners.delete(listener);
    };
  }

  getDaemonClient(hostId: string): DaemonClientLike | null {
    return this.connections.get(hostId)?.client ?? null;
  }
}

export function createClientConfig(host: Host): DaemonClientConfig {
  const connection = host.connection;
  const url = buildRelayWebSocketUrl({
    endpoint: connection.relayEndpoint,
    useTls: connection.useTls ?? shouldUseTlsForDefaultHostedRelay(connection.relayEndpoint),
    serverId: connection.serverId,
    role: "client",
  });

  return {
    url,
    clientId: `paseo-board-web-${host.id}`,
    clientType: "browser",
    connectTimeoutMs: 30_000,
    e2ee: {
      enabled: true,
      daemonPublicKeyB64: connection.daemonPublicKeyB64,
    },
    reconnect: { enabled: true },
  };
}
