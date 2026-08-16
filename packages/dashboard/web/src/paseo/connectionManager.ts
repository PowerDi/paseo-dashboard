import {
  DaemonClient,
  type ConnectionState,
  type DaemonClientConfig,
} from "@getpaseo/client/internal/daemon-client";
import type { Host } from "@getpaseo/dashboard-shared";
import {
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";

export type HostConnectionState = ConnectionState;
export type DaemonClientLike = Pick<
  DaemonClient,
  | "connect"
  | "close"
  | "getConnectionState"
  | "subscribeConnectionStatus"
  | "getLastServerInfoMessage"
  | "on"
  | "archiveAgent"
  | "cancelAgent"
  | "fetchAgentTimeline"
  | "setAgentTimelineSubscription"
  | "sendAgentMessage"
  | "createAgent"
  | "resumeAgent"
  | "respondToPermission"
  | "respondToPermissionAndWait"
  | "applyAgentConfig"
  | "getProvidersSnapshot"
  | "listTerminals"
  | "createTerminal"
  | "killTerminal"
  | "subscribeTerminal"
  | "unsubscribeTerminal"
  | "sendTerminalInput"
  | "onTerminalStreamEvent"
  | "listDirectory"
  | "readFile"
  | "subscribeFile"
>;
export type DaemonClientFactory = (config: DaemonClientConfig) => DaemonClientLike;
export type PaseoConnectionListener = (state: HostConnectionState) => void;

interface ManagedConnection {
  client: DaemonClientLike;
  connectPromise: Promise<void> | null;
  rejectPendingConnect: ((error: Error) => void) | null;
  detached: boolean;
  unsubscribeClient: () => void;
}

interface HostConnectionSlot {
  connection: ManagedConnection | null;
  listeners: Set<PaseoConnectionListener>;
  state: HostConnectionState;
}

export interface PaseoConnectionManager {
  connect(host: Host): Promise<void>;
  disconnect(hostId: string): Promise<void>;
  disconnectAll(): Promise<void>;
  getState(hostId: string): HostConnectionState;
  subscribe(hostId: string, listener: PaseoConnectionListener): () => void;
  getDaemonClient(hostId: string): DaemonClientLike | null;
}

export class DefaultPaseoConnectionManager implements PaseoConnectionManager {
  private readonly slots = new Map<string, HostConnectionSlot>();

  constructor(
    private readonly createClient: DaemonClientFactory = (config) => new DaemonClient(config),
  ) {}

  async connect(host: Host): Promise<void> {
    const slot = this.getOrCreateSlot(host.id);
    const existing = slot.connection;

    if (existing) {
      if (slot.state.status === "connected") return;
      if (existing.connectPromise) return existing.connectPromise;
      if (slot.state.status === "connecting") return;

      if (slot.state.status !== "disposed") {
        return this.startConnect(host.id, slot, existing);
      }

      this.detachConnection(host.id, slot, existing, { status: "idle" });
    }

    let client: DaemonClientLike;
    try {
      client = this.createClient(createClientConfig(host));
    } catch (error) {
      this.deleteUnusedSlot(host.id, slot);
      throw error;
    }

    const connection: ManagedConnection = {
      client,
      connectPromise: null,
      rejectPendingConnect: null,
      detached: false,
      unsubscribeClient: () => undefined,
    };
    slot.connection = connection;

    try {
      connection.unsubscribeClient = client.subscribeConnectionStatus((state) => {
        if (slot.connection !== connection || connection.detached) return;
        this.updateState(slot, state);
      });
    } catch (error) {
      this.detachConnection(host.id, slot, connection, { status: "idle" });
      await client.close().catch(() => undefined);
      throw error;
    }

    return this.startConnect(host.id, slot, connection);
  }

  async disconnect(hostId: string): Promise<void> {
    const slot = this.slots.get(hostId);
    const connection = slot?.connection;
    if (!slot || !connection) return;

    this.detachConnection(hostId, slot, connection, { status: "idle" });
    connection.rejectPendingConnect?.(new Error(`Connection closed for host ${hostId}`));
    await connection.client.close();
  }

  async disconnectAll(): Promise<void> {
    const hostIds = [...this.slots.entries()]
      .filter(([, slot]) => slot.connection !== null)
      .map(([hostId]) => hostId);
    const results = await Promise.allSettled(hostIds.map((hostId) => this.disconnect(hostId)));
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Failed to close Paseo connections");
  }

  getState(hostId: string): HostConnectionState {
    return this.slots.get(hostId)?.state ?? { status: "idle" };
  }

  subscribe(hostId: string, listener: PaseoConnectionListener): () => void {
    const slot = this.getOrCreateSlot(hostId);
    slot.listeners.add(listener);
    listener(slot.state);

    return () => {
      slot.listeners.delete(listener);
      this.deleteUnusedSlot(hostId, slot);
    };
  }

  getDaemonClient(hostId: string): DaemonClientLike | null {
    return this.slots.get(hostId)?.connection?.client ?? null;
  }

  private getOrCreateSlot(hostId: string): HostConnectionSlot {
    const existing = this.slots.get(hostId);
    if (existing) return existing;

    const slot: HostConnectionSlot = {
      connection: null,
      listeners: new Set(),
      state: { status: "idle" },
    };
    this.slots.set(hostId, slot);
    return slot;
  }

  private startConnect(
    hostId: string,
    slot: HostConnectionSlot,
    connection: ManagedConnection,
  ): Promise<void> {
    let clientPromise: Promise<void>;
    try {
      clientPromise = connection.client.connect();
    } catch (error) {
      clientPromise = Promise.reject(error);
    }

    const guardedClientPromise = new Promise<void>((resolve, reject) => {
      connection.rejectPendingConnect = reject;
      void clientPromise.then(resolve, reject);
    });
    const connectPromise = guardedClientPromise
      .catch(async (error) => {
        if (this.detachConnection(hostId, slot, connection, { status: "idle" })) {
          await connection.client.close().catch(() => undefined);
        }
        throw error;
      })
      .finally(() => {
        if (connection.connectPromise === connectPromise) {
          connection.connectPromise = null;
          connection.rejectPendingConnect = null;
        }
      });
    connection.connectPromise = connectPromise;
    return connectPromise;
  }

  private detachConnection(
    hostId: string,
    slot: HostConnectionSlot,
    connection: ManagedConnection,
    nextState: HostConnectionState,
  ): boolean {
    if (slot.connection !== connection || connection.detached) return false;

    connection.detached = true;
    connection.unsubscribeClient();
    slot.connection = null;
    this.updateState(slot, nextState);
    this.deleteUnusedSlot(hostId, slot);
    return true;
  }

  private updateState(slot: HostConnectionSlot, state: HostConnectionState): void {
    if (connectionStatesEqual(slot.state, state)) return;

    slot.state = state;
    for (const listener of slot.listeners) {
      listener(state);
    }
  }

  private deleteUnusedSlot(hostId: string, slot: HostConnectionSlot): void {
    if (slot.connection === null && slot.listeners.size === 0 && this.slots.get(hostId) === slot) {
      this.slots.delete(hostId);
    }
  }
}

function connectionStatesEqual(left: ConnectionState, right: ConnectionState): boolean {
  if (left.status !== right.status) return false;
  if (left.status === "connecting" && right.status === "connecting") {
    return left.attempt === right.attempt;
  }
  if (left.status === "disconnected" && right.status === "disconnected") {
    return left.reason === right.reason;
  }
  return true;
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
