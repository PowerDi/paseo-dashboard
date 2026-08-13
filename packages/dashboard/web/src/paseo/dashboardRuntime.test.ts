import type { ConnectionState, DaemonClientConfig } from "@getpaseo/client/internal/daemon-client";
import type { Host } from "@getpaseo/dashboard-shared";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { describe, expect, test, vi } from "vitest";
import type {
  DaemonAgentEntry,
  DaemonDataClient,
  DaemonProject,
  DaemonWorkspace,
} from "../stores/daemon-data-store";
import { DefaultPaseoConnectionManager, type DaemonClientLike } from "./connectionManager";
import { createDashboardRuntime } from "./dashboardRuntime";

type ProjectListResult = Awaited<ReturnType<DaemonDataClient["listProjects"]>>;
type WorkspaceListResult = Awaited<ReturnType<DaemonDataClient["fetchWorkspaces"]>>;
type AgentListResult = Awaited<ReturnType<DaemonDataClient["fetchAgents"]>>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function makeHost(id: string): Host {
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

function project(hostId: string): DaemonProject {
  return {
    projectId: `project-${hostId}`,
    projectKey: `project-${hostId}`,
    projectDisplayName: `Project ${hostId}`,
    projectCustomName: null,
    projectCustomIconRevision: null,
    projectRootPath: `/projects/${hostId}`,
    projectKind: "git",
  };
}

function projectResult(hostId: string): ProjectListResult {
  return { requestId: `projects-${hostId}`, projects: [project(hostId)] };
}

function workspace(hostId: string): DaemonWorkspace {
  return {
    id: `workspace-${hostId}`,
    projectId: `project-${hostId}`,
    projectDisplayName: `Project ${hostId}`,
    projectRootPath: `/projects/${hostId}`,
    workspaceDirectory: `/projects/${hostId}`,
    projectKind: "git",
    workspaceKind: "directory",
    name: hostId,
    archivingAt: null,
    status: "done",
    statusEnteredAt: null,
    activityAt: "2026-08-12T00:00:00.000Z",
    scripts: [],
    gitRuntime: null,
    githubRuntime: null,
  };
}

function workspaceResult(hostId: string): WorkspaceListResult {
  return {
    requestId: `workspaces-${hostId}`,
    entries: [workspace(hostId)],
    emptyProjects: [],
    pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
  };
}

function agentEntry(hostId: string): DaemonAgentEntry {
  return {
    agent: {
      id: `agent-${hostId}`,
      provider: "codex",
      cwd: `/projects/${hostId}`,
      model: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsRewindBoth: false,
        supportsRewindConversation: false,
        supportsRewindFiles: false,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
      archivedAt: null,
    },
    project: {
      projectKey: `project-${hostId}`,
      projectName: `Project ${hostId}`,
      workspaceName: hostId,
      checkout: {
        cwd: `/projects/${hostId}`,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function agentResult(hostId: string): AgentListResult {
  return {
    requestId: `agents-${hostId}`,
    entries: [agentEntry(hostId)],
    pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
  };
}

function timelinePage(agentId: string) {
  return {
    requestId: "req-timeline",
    agentId,
    agent: null,
    direction: "tail" as const,
    projection: "projected" as const,
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq: 1, nextSeq: 2 },
    startCursor: { seq: 0, epoch: "epoch-1" },
    endCursor: { seq: 1, epoch: "epoch-1" },
    hasOlder: false,
    hasNewer: false,
    entries: [
      {
        provider: "codex" as const,
        item: { type: "assistant_message" as const, text: "hello" },
        timestamp: "2026-08-13T00:00:00.000Z",
        seqStart: 0,
        seqEnd: 1,
        sourceSeqRanges: [{ startSeq: 0, endSeq: 1 }],
        collapsed: [],
      },
    ],
    error: null,
  };
}

class RuntimeClient implements DaemonClientLike, DaemonDataClient {
  private state: ConnectionState = { status: "idle" };
  private readonly listeners = new Set<(state: ConnectionState) => void>();
  closeCalls = 0;
  readonly listProjects = vi.fn(async () => projectResult(this.hostId));
  readonly fetchWorkspaces = vi.fn(async () => workspaceResult(this.hostId));
  readonly fetchAgents = vi.fn(async () => agentResult(this.hostId));

  constructor(
    readonly hostId: string,
    readonly config: DaemonClientConfig,
    private readonly connectBehavior: (client: RuntimeClient) => Promise<void> = async (client) => {
      client.emit({ status: "connecting", attempt: 1 });
      client.emit({ status: "connected" });
    },
  ) {}

  connect(): Promise<void> {
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
    return () => this.listeners.delete(listener);
  }

  getLastServerInfoMessage(): null {
    return null;
  }

  private readonly messageListeners = new Map<
    string,
    Set<(message: SessionOutboundMessage) => void>
  >();
  readonly archiveAgent = vi.fn(async (_agentId: string) => ({
    archivedAt: "2026-08-13T00:00:00.000Z",
  }));
  readonly cancelAgent = vi.fn(async (_agentId: string) => undefined);
  readonly setAgentTimelineSubscription = vi.fn(async (_agentIds: string[]) => undefined);
  readonly fetchAgentTimeline = vi.fn(async (agentId: string) => timelinePage(agentId));
  readonly sendAgentMessage = vi.fn(async (_agentId: string, _text: string) => undefined);
  readonly createAgent = vi.fn(async () => ({
    ...agentEntry(this.hostId).agent,
    id: `created-${this.hostId}`,
  })) as unknown as DaemonClientLike["createAgent"];
  readonly resumeAgent = vi.fn(async () => ({
    ...agentEntry(this.hostId).agent,
    archivedAt: null,
  })) as unknown as DaemonClientLike["resumeAgent"];
  readonly respondToPermission = vi.fn(async () => undefined);

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

  // Property with an assertion because matching DaemonClient's `on` overload
  // set (including the DaemonEventHandler variant) is not worth it in a fake.
  readonly on = ((
    type: SessionOutboundMessage["type"] | ((message: SessionOutboundMessage) => void),
    handler?: (message: SessionOutboundMessage) => void,
  ) => {
    if (typeof type === "function" || !handler) return () => undefined;
    const listeners = this.messageListeners.get(type) ?? new Set();
    listeners.add(handler);
    this.messageListeners.set(type, listeners);
    return () => listeners.delete(handler);
  }) as DaemonClientLike["on"];

  emitMessage(message: SessionOutboundMessage): void {
    for (const listener of this.messageListeners.get(message.type) ?? []) {
      listener(message);
    }
  }

  messageListenerCount(type: string): number {
    return this.messageListeners.get(type)?.size ?? 0;
  }

  emit(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function createRuntimeWithClients(
  createClient: (hostId: string, config: DaemonClientConfig) => RuntimeClient = (hostId, config) =>
    new RuntimeClient(hostId, config),
) {
  const clients = new Map<string, RuntimeClient>();
  const manager = new DefaultPaseoConnectionManager((config) => {
    const hostId = config.clientId.replace("paseo-board-web-", "");
    const client = createClient(hostId, config);
    clients.set(hostId, client);
    return client;
  });
  return { clients, runtime: createDashboardRuntime({ connectionManager: manager }) };
}

describe("dashboard Paseo runtime", () => {
  test("connects and loads daemon data independently for multiple hosts", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    const hostAStates: string[] = [];
    const unsubscribe = runtime.subscribe("host-a", (state) => {
      hostAStates.push(state.connection.status);
    });

    await Promise.all([
      runtime.connectHost(makeHost("host-a")),
      runtime.connectHost(makeHost("host-b")),
    ]);

    expect(runtime.get("host-a")).toMatchObject({
      connection: { status: "connected" },
      daemonData: {
        projects: { data: [project("host-a")] },
        workspaces: { data: [workspace("host-a")] },
        agents: { data: [agentEntry("host-a")] },
      },
    });
    expect(runtime.get("host-b")).toMatchObject({
      connection: { status: "connected" },
      daemonData: {
        projects: { data: [project("host-b")] },
        workspaces: { data: [workspace("host-b")] },
        agents: { data: [agentEntry("host-b")] },
      },
    });
    expect(clients.get("host-a")?.listProjects).toHaveBeenCalledOnce();
    expect(clients.get("host-b")?.listProjects).toHaveBeenCalledOnce();
    expect(hostAStates).toContain("connecting");
    expect(hostAStates.at(-1)).toBe("connected");

    unsubscribe();
  });

  test("does not create daemon store data when connecting fails", async () => {
    const { runtime } = createRuntimeWithClients(
      (hostId, config) =>
        new RuntimeClient(hostId, config, async (client) => {
          client.emit({ status: "connecting", attempt: 1 });
          throw new Error("relay unavailable");
        }),
    );

    await expect(runtime.connectHost(makeHost("host-failed"))).rejects.toThrow("relay unavailable");

    expect(runtime.get("host-failed")).toEqual({
      connection: { status: "idle" },
      daemonData: null,
    });
  });

  test("disconnects one host, clears its data, and ignores late load results", async () => {
    const projects = deferred<ProjectListResult>();
    const { clients, runtime } = createRuntimeWithClients((hostId, config) => {
      const client = new RuntimeClient(hostId, config);
      if (hostId === "host-a") client.listProjects.mockReturnValue(projects.promise);
      return client;
    });

    const hostAConnect = runtime.connectHost(makeHost("host-a"));
    await runtime.connectHost(makeHost("host-b"));
    await runtime.disconnectHost("host-a");
    projects.resolve(projectResult("host-a"));
    await hostAConnect;

    expect(clients.get("host-a")?.closeCalls).toBe(1);
    expect(runtime.get("host-a")).toEqual({
      connection: { status: "idle" },
      daemonData: null,
    });
    expect(runtime.get("host-b")).toMatchObject({
      connection: { status: "connected" },
      daemonData: { projects: { data: [project("host-b")] } },
    });
  });

  test("applies daemon push updates to the host data", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));
    const client = clients.get("host-a")!;

    client.emitMessage({
      type: "agent_update",
      payload: {
        kind: "upsert",
        agent: { ...agentEntry("host-a").agent, status: "running" },
      },
    });

    expect(runtime.get("host-a").daemonData?.agents.data[0]?.agent.status).toBe("running");

    client.emitMessage({
      type: "agent_update",
      payload: { kind: "remove", agentId: "agent-host-a" },
    });

    expect(runtime.get("host-a").daemonData?.agents.data).toEqual([]);
  });

  test("refreshes daemon data after a reconnect", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));
    const client = clients.get("host-a")!;
    expect(client.fetchAgents).toHaveBeenCalledTimes(1);

    client.emit({ status: "disconnected", reason: "network" });
    client.emit({ status: "connected" });

    await vi.waitFor(() => {
      expect(client.fetchAgents).toHaveBeenCalledTimes(2);
    });
  });

  test("archiveAgent calls the daemon and marks the entry archived locally", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));

    await runtime.archiveAgent("host-a", "agent-host-a");

    expect(clients.get("host-a")?.archiveAgent).toHaveBeenCalledWith("agent-host-a");
    expect(runtime.get("host-a").daemonData?.agents.data[0]?.agent.archivedAt).toBe(
      "2026-08-13T00:00:00.000Z",
    );
  });

  test("cancelAgent forwards to the daemon client", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));

    await runtime.cancelAgent("host-a", "agent-host-a");

    expect(clients.get("host-a")?.cancelAgent).toHaveBeenCalledWith("agent-host-a");
  });

  test("sendAgentMessage forwards to the daemon client", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));

    await runtime.sendAgentMessage("host-a", "agent-host-a", "hello");

    expect(clients.get("host-a")?.sendAgentMessage).toHaveBeenCalledWith("agent-host-a", "hello");
  });

  test("createAgent forwards options and returns the snapshot", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));

    const agent = await runtime.createAgent("host-a", {
      provider: "codex",
      cwd: "/projects/host-a",
      initialPrompt: "do the thing",
    });

    expect(clients.get("host-a")?.createAgent).toHaveBeenCalledWith({
      provider: "codex",
      cwd: "/projects/host-a",
      initialPrompt: "do the thing",
    });
    expect(agent.id).toBe("created-host-a");
  });

  test("resumeAgent uses the persistence handle and clears archivedAt locally", async () => {
    const handle = { provider: "codex" as const, sessionId: "sess-1" };
    const { clients, runtime } = createRuntimeWithClients((hostId, config) => {
      const client = new RuntimeClient(hostId, config);
      client.fetchAgents.mockImplementation(async () => {
        const result = agentResult(hostId);
        result.entries[0].agent.persistence = handle;
        result.entries[0].agent.archivedAt = "2026-08-13T00:00:00.000Z";
        return result;
      });
      return client;
    });
    await runtime.connectHost(makeHost("host-a"));

    await runtime.resumeAgent("host-a", "agent-host-a");

    expect(clients.get("host-a")?.resumeAgent).toHaveBeenCalledWith(handle);
    expect(runtime.get("host-a").daemonData?.agents.data[0]?.agent.archivedAt).toBeNull();
  });

  test("resumeAgent rejects when the agent has no persistence handle", async () => {
    const { runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));

    await expect(runtime.resumeAgent("host-a", "agent-host-a")).rejects.toThrow(
      "no persistence handle",
    );
  });

  test("respondToPermission forwards the response and clears the request locally", async () => {
    const permission = {
      id: "perm-1",
      provider: "codex" as const,
      name: "shell",
      kind: "tool" as const,
    };
    const { clients, runtime } = createRuntimeWithClients((hostId, config) => {
      const client = new RuntimeClient(hostId, config);
      client.fetchAgents.mockImplementation(async () => {
        const result = agentResult(hostId);
        result.entries[0].agent.pendingPermissions = [permission];
        return result;
      });
      return client;
    });
    await runtime.connectHost(makeHost("host-a"));

    await runtime.respondToPermission("host-a", "agent-host-a", "perm-1", { behavior: "allow" });

    expect(clients.get("host-a")?.respondToPermission).toHaveBeenCalledWith(
      "agent-host-a",
      "perm-1",
      { behavior: "allow" },
    );
    expect(runtime.get("host-a").daemonData?.agents.data[0]?.agent.pendingPermissions).toEqual([]);
  });

  test("viewAgent subscribes the selective stream and loads the timeline tail", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));
    const client = clients.get("host-a")!;

    await runtime.viewAgent("host-a", "agent-host-a");

    expect(client.setAgentTimelineSubscription).toHaveBeenCalledWith(["agent-host-a"]);
    expect(client.fetchAgentTimeline).toHaveBeenCalledWith("agent-host-a", {
      direction: "tail",
      limit: 50,
    });
    const timeline = runtime.getTimeline("host-a", "agent-host-a");
    expect(timeline?.entries).toHaveLength(1);
    expect(timeline?.epoch).toBe("epoch-1");
  });

  test("leaveAgent clears the timeline and the selective subscription", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));
    await runtime.viewAgent("host-a", "agent-host-a");

    await runtime.leaveAgent("host-a", "agent-host-a");

    expect(clients.get("host-a")?.setAgentTimelineSubscription).toHaveBeenLastCalledWith([]);
    expect(runtime.getTimeline("host-a", "agent-host-a")).toBeNull();
  });

  test("agent_stream events refresh the viewed timeline", async () => {
    vi.useFakeTimers();
    try {
      const { clients, runtime } = createRuntimeWithClients();
      await runtime.connectHost(makeHost("host-a"));
      await runtime.viewAgent("host-a", "agent-host-a");
      const client = clients.get("host-a")!;
      expect(client.fetchAgentTimeline).toHaveBeenCalledTimes(1);

      client.emitMessage({
        type: "agent_stream",
        payload: {
          agentId: "agent-host-a",
          event: { type: "turn_completed", provider: "codex" },
          timestamp: "2026-08-13T00:00:01.000Z",
          seq: 5,
          epoch: "epoch-1",
        },
      });
      await vi.advanceTimersByTimeAsync(500);

      expect(client.fetchAgentTimeline).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("stops listening to daemon pushes after disconnect", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await runtime.connectHost(makeHost("host-a"));
    const client = clients.get("host-a")!;
    expect(client.messageListenerCount("agent_update")).toBe(1);

    await runtime.disconnectHost("host-a");

    expect(client.messageListenerCount("agent_update")).toBe(0);
  });

  test("disconnectAll closes every host and clears all daemon data for logout", async () => {
    const { clients, runtime } = createRuntimeWithClients();
    await Promise.all([
      runtime.connectHost(makeHost("host-a")),
      runtime.connectHost(makeHost("host-b")),
    ]);

    await runtime.disconnectAll();

    expect(clients.get("host-a")?.closeCalls).toBe(1);
    expect(clients.get("host-b")?.closeCalls).toBe(1);
    expect(runtime.get("host-a")).toEqual({
      connection: { status: "idle" },
      daemonData: null,
    });
    expect(runtime.get("host-b")).toEqual({
      connection: { status: "idle" },
      daemonData: null,
    });
  });
});
