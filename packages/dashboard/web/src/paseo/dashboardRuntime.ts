import type { Host } from "@getpaseo/dashboard-shared";
import type { StoreApi } from "zustand/vanilla";
import {
  createDaemonDataStore,
  type DaemonDataClient,
  type DaemonDataStoreState,
  type DaemonHostDataState,
} from "../stores/daemon-data-store";
import {
  createTimelineStore,
  timelineKey,
  type AgentTimelineState,
  type TimelineStoreState,
} from "../stores/timeline-store";
import {
  DefaultPaseoConnectionManager,
  type DaemonClientLike,
  type HostConnectionState,
  type PaseoConnectionManager,
} from "./connectionManager";

export interface DashboardHostRuntimeState {
  connection: HostConnectionState;
  daemonData: DaemonHostDataState | null;
}

export type DashboardRuntimeListener = (state: DashboardHostRuntimeState) => void;

export interface DashboardPaseoRuntime {
  connectHost(host: Host): Promise<void>;
  disconnectHost(hostId: string): Promise<void>;
  disconnectAll(): Promise<void>;
  get(hostId: string): DashboardHostRuntimeState;
  subscribe(hostId: string, listener: DashboardRuntimeListener): () => void;
  /**
   * Connects to the host, reads the daemon version from server_info, and
   * disconnects. Used by the import flow to verify a pairing link before
   * persisting it. Does not load daemon data.
   */
  verifyConnection(host: Host): Promise<{ serverVersion: string }>;
  archiveAgent(hostId: string, agentId: string): Promise<void>;
  cancelAgent(hostId: string, agentId: string): Promise<void>;
  /**
   * Marks an agent as viewed: subscribes the daemon's selective timeline
   * stream to it and loads the latest tail page.
   */
  viewAgent(hostId: string, agentId: string): Promise<void>;
  leaveAgent(hostId: string, agentId: string): Promise<void>;
  loadOlderTimeline(hostId: string, agentId: string): Promise<void>;
  getTimeline(hostId: string, agentId: string): AgentTimelineState | null;
  subscribeTimeline(
    hostId: string,
    agentId: string,
    listener: (state: AgentTimelineState | null) => void,
  ): () => void;
}

export interface DashboardRuntimeDependencies {
  connectionManager?: PaseoConnectionManager;
  daemonDataStore?: StoreApi<DaemonDataStoreState>;
  timelineStore?: StoreApi<TimelineStoreState>;
}

interface HostAttachment {
  client: DaemonClientLike;
  unsubscribes: (() => void)[];
  lastStatus: HostConnectionState["status"];
}

export function createDashboardRuntime(
  dependencies: DashboardRuntimeDependencies = {},
): DashboardPaseoRuntime {
  const connectionManager = dependencies.connectionManager ?? new DefaultPaseoConnectionManager();
  const daemonDataStore =
    dependencies.daemonDataStore ??
    createDaemonDataStore({
      getClient: (hostId) => getDaemonDataClient(connectionManager, hostId),
    });
  const timelineStore =
    dependencies.timelineStore ??
    createTimelineStore({
      getClient: (hostId) => connectionManager.getDaemonClient(hostId),
    });
  const attachments = new Map<string, HostAttachment>();

  function get(hostId: string): DashboardHostRuntimeState {
    return {
      connection: connectionManager.getState(hostId),
      daemonData: daemonDataStore.getState().byHost.get(hostId) ?? null,
    };
  }

  function detach(hostId: string): void {
    const attachment = attachments.get(hostId);
    if (!attachment) return;
    attachments.delete(hostId);
    for (const unsubscribe of attachment.unsubscribes) unsubscribe();
  }

  /**
   * Subscribes to daemon push updates for the host and refreshes the loaded
   * data after a reconnect (events during the outage are lost). Idempotent
   * per client instance; connectHost re-attaches when a new client is made.
   */
  function attach(hostId: string): void {
    const client = connectionManager.getDaemonClient(hostId);
    if (!client) return;
    if (attachments.get(hostId)?.client === client) return;
    detach(hostId);

    const store = daemonDataStore.getState();
    const attachment: HostAttachment = {
      client,
      unsubscribes: [
        client.on("agent_update", (message) => {
          store.applyAgentUpdate(hostId, message.payload);
        }),
        client.on("workspace_update", (message) => {
          store.applyWorkspaceUpdate(hostId, message.payload);
        }),
        client.on("project.update", (message) => {
          store.applyProjectUpdate(hostId, message.payload);
        }),
        client.on("agent_stream", (message) => {
          timelineStore.getState().notifyStreamEvent(hostId, message.payload);
        }),
      ],
      lastStatus: connectionManager.getState(hostId).status,
    };
    attachment.unsubscribes.push(
      connectionManager.subscribe(hostId, (state) => {
        const previous = attachment.lastStatus;
        attachment.lastStatus = state.status;
        if (state.status !== "connected" || previous === "connected") return;
        if (!daemonDataStore.getState().byHost.has(hostId)) return;
        void daemonDataStore
          .getState()
          .refreshHost(hostId)
          .catch(() => undefined);
      }),
    );
    attachments.set(hostId, attachment);
  }

  function requireClient(hostId: string): DaemonClientLike {
    const client = connectionManager.getDaemonClient(hostId);
    if (!client) throw new Error(`Host ${hostId} is not connected`);
    return client;
  }

  return {
    async connectHost(host) {
      try {
        await connectionManager.connect(host);
        attach(host.id);
        await daemonDataStore.getState().loadHost(host.id);
      } catch (error) {
        detach(host.id);
        daemonDataStore.getState().clearHost(host.id);
        throw error;
      }
    },

    async disconnectHost(hostId) {
      detach(hostId);
      timelineStore.getState().clearHost(hostId);
      try {
        await connectionManager.disconnect(hostId);
      } finally {
        daemonDataStore.getState().clearHost(hostId);
      }
    },

    async disconnectAll() {
      // Deleting the current entry while iterating a Map is safe.
      for (const hostId of attachments.keys()) detach(hostId);
      timelineStore.getState().clear();
      try {
        await connectionManager.disconnectAll();
      } finally {
        daemonDataStore.getState().clear();
      }
    },

    async verifyConnection(host) {
      try {
        await connectionManager.connect(host);
        const info = connectionManager.getDaemonClient(host.id)?.getLastServerInfoMessage() ?? null;
        return { serverVersion: info?.version ?? "unknown" };
      } finally {
        await connectionManager.disconnect(host.id).catch(() => undefined);
      }
    },

    async archiveAgent(hostId, agentId) {
      const client = requireClient(hostId);
      const { archivedAt } = await client.archiveAgent(agentId);
      // Apply locally so the row disappears even if the daemon's broadcast is
      // delayed or lost.
      const entry = daemonDataStore
        .getState()
        .byHost.get(hostId)
        ?.agents.data.find((candidate) => candidate.agent.id === agentId);
      if (entry) {
        daemonDataStore.getState().applyAgentUpdate(hostId, {
          kind: "upsert",
          agent: { ...entry.agent, archivedAt },
        });
      }
    },

    async cancelAgent(hostId, agentId) {
      await requireClient(hostId).cancelAgent(agentId);
    },

    async viewAgent(hostId, agentId) {
      const client = connectionManager.getDaemonClient(hostId);
      // Selective daemons only stream subscribed agents; legacy daemons
      // ignore this (the client no-ops without the feature flag).
      await client?.setAgentTimelineSubscription([agentId]).catch(() => undefined);
      await timelineStore.getState().open(hostId, agentId);
    },

    async leaveAgent(hostId, agentId) {
      timelineStore.getState().close(hostId, agentId);
      const client = connectionManager.getDaemonClient(hostId);
      await client?.setAgentTimelineSubscription([]).catch(() => undefined);
    },

    async loadOlderTimeline(hostId, agentId) {
      await timelineStore.getState().loadOlder(hostId, agentId);
    },

    getTimeline(hostId, agentId) {
      return timelineStore.getState().byKey.get(timelineKey(hostId, agentId)) ?? null;
    },

    subscribeTimeline(hostId, agentId, listener) {
      const key = timelineKey(hostId, agentId);
      let current = timelineStore.getState().byKey.get(key) ?? null;
      listener(current);
      return timelineStore.subscribe((state) => {
        const next = state.byKey.get(key) ?? null;
        if (next === current) return;
        current = next;
        listener(next);
      });
    },

    get,

    subscribe(hostId, listener) {
      let current = get(hostId);
      listener(current);

      const emitIfChanged = () => {
        const next = get(hostId);
        if (runtimeStatesEqual(current, next)) return;
        current = next;
        listener(next);
      };

      const unsubscribeConnection = connectionManager.subscribe(hostId, emitIfChanged);
      const unsubscribeDaemonData = daemonDataStore.subscribe(emitIfChanged);

      return () => {
        unsubscribeDaemonData();
        unsubscribeConnection();
      };
    },
  };
}

export const dashboardRuntime = createDashboardRuntime();

function getDaemonDataClient(
  connectionManager: PaseoConnectionManager,
  hostId: string,
): DaemonDataClient | null {
  const client = connectionManager.getDaemonClient(hostId);
  if (!client) return null;
  if (!supportsDaemonData(client)) {
    throw new Error(`Daemon client for host ${hostId} does not support dashboard data loading`);
  }
  return client;
}

function supportsDaemonData(
  client: DaemonClientLike,
): client is DaemonClientLike & DaemonDataClient {
  const candidate = client as DaemonClientLike & Partial<DaemonDataClient>;
  return (
    typeof candidate.listProjects === "function" &&
    typeof candidate.fetchWorkspaces === "function" &&
    typeof candidate.fetchAgents === "function"
  );
}

function runtimeStatesEqual(
  left: DashboardHostRuntimeState,
  right: DashboardHostRuntimeState,
): boolean {
  return (
    connectionStatesEqual(left.connection, right.connection) && left.daemonData === right.daemonData
  );
}

function connectionStatesEqual(left: HostConnectionState, right: HostConnectionState): boolean {
  if (left.status !== right.status) return false;
  if (left.status === "connecting" && right.status === "connecting") {
    return left.attempt === right.attempt;
  }
  if (left.status === "disconnected" && right.status === "disconnected") {
    return left.reason === right.reason;
  }
  return true;
}
