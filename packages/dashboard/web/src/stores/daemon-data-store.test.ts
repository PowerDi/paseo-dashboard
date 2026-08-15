import { describe, expect, test, vi } from "vitest";
import {
  createDaemonDataStore,
  type DaemonAgentEntry,
  type DaemonDataClient,
  type DaemonProject,
  type DaemonWorkspace,
} from "./daemon-data-store";

type ProjectListResult = Awaited<ReturnType<DaemonDataClient["listProjects"]>>;
type WorkspaceListResult = Awaited<ReturnType<DaemonDataClient["fetchWorkspaces"]>>;
type AgentListResult = Awaited<ReturnType<DaemonDataClient["fetchAgents"]>>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface ClientOverrides {
  listProjects?: DaemonDataClient["listProjects"];
  fetchWorkspaces?: DaemonDataClient["fetchWorkspaces"];
  fetchAgents?: DaemonDataClient["fetchAgents"];
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void;
  let rejectPromise: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise(value),
    reject: (error) => rejectPromise(error),
  };
}

function project(projectId: string): DaemonProject {
  return {
    projectId,
    projectKey: projectId,
    projectDisplayName: `Project ${projectId}`,
    projectCustomName: null,
    projectCustomIconRevision: null,
    projectRootPath: `/projects/${projectId}`,
    projectKind: "git",
  };
}

function projectResult(...projects: DaemonProject[]): ProjectListResult {
  return { requestId: "req-projects", projects };
}

function emptyWorkspaceResult(): WorkspaceListResult {
  return {
    requestId: "req-workspaces",
    entries: [],
    emptyProjects: [],
    pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
  };
}

function emptyAgentResult(): AgentListResult {
  return {
    requestId: "req-agents",
    entries: [],
    pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
  };
}

function createClient(overrides: ClientOverrides = {}): DaemonDataClient {
  return {
    listProjects: overrides.listProjects ?? (async () => projectResult()),
    fetchWorkspaces: overrides.fetchWorkspaces ?? (async () => emptyWorkspaceResult()),
    fetchAgents: overrides.fetchAgents ?? (async () => emptyAgentResult()),
  };
}

describe("daemon data store", () => {
  test("keeps daemon data isolated by host", async () => {
    const clients = new Map<string, DaemonDataClient>([
      ["host-a", createClient({ listProjects: async () => projectResult(project("a")) })],
      ["host-b", createClient({ listProjects: async () => projectResult(project("b")) })],
    ]);
    const store = createDaemonDataStore({
      getClient: (hostId) => clients.get(hostId) ?? null,
      now: () => 100,
    });

    await Promise.all([
      store.getState().loadProjects("host-a"),
      store.getState().loadProjects("host-b"),
    ]);

    expect(store.getState().byHost.get("host-a")?.projects.data).toEqual([project("a")]);
    expect(store.getState().byHost.get("host-b")?.projects.data).toEqual([project("b")]);
  });

  test("loads projects, workspaces, and agents successfully", async () => {
    const listProjects = vi.fn(async () => projectResult(project("main")));
    const fetchWorkspaces = vi.fn(async () => emptyWorkspaceResult());
    const fetchAgents = vi.fn(async () => emptyAgentResult());
    const store = createDaemonDataStore({
      getClient: () => createClient({ listProjects, fetchWorkspaces, fetchAgents }),
      now: () => 1234,
    });

    await store.getState().loadHost("host-a");

    const host = store.getState().byHost.get("host-a");
    expect(host).toEqual({
      projects: {
        loading: false,
        error: null,
        data: [project("main")],
        lastUpdated: 1234,
      },
      workspaces: { loading: false, error: null, data: [], lastUpdated: 1234 },
      agents: { loading: false, error: null, data: [], lastUpdated: 1234 },
    });
    expect(listProjects).toHaveBeenCalledOnce();
    expect(fetchWorkspaces).toHaveBeenCalledWith({ page: { limit: 200 } });
    expect(fetchAgents).toHaveBeenCalledWith({
      page: { limit: 200 },
      subscribe: { subscriptionId: "dashboard:host-a" },
    });
  });

  test("subscribes only while loading the first agent page", async () => {
    const fetchAgents = vi
      .fn<DaemonDataClient["fetchAgents"]>()
      .mockResolvedValueOnce({
        requestId: "req-agents-first",
        entries: [agentEntry("agent-1", "main")],
        pageInfo: { nextCursor: "next", prevCursor: null, hasMore: true },
      })
      .mockResolvedValueOnce(agentResult(agentEntry("agent-2", "main")));
    const store = createDaemonDataStore({
      getClient: () => createClient({ fetchAgents }),
      now: () => 1234,
    });

    await store.getState().loadAgents("host-a");

    expect(fetchAgents).toHaveBeenNthCalledWith(1, {
      page: { limit: 200 },
      subscribe: { subscriptionId: "dashboard:host-a" },
    });
    expect(fetchAgents).toHaveBeenNthCalledWith(2, { page: { limit: 200, cursor: "next" } });
  });
  test("can retry after a failed load", async () => {
    const listProjects = vi
      .fn<DaemonDataClient["listProjects"]>()
      .mockRejectedValueOnce(new Error("daemon unavailable"))
      .mockResolvedValueOnce(projectResult(project("recovered")));
    const store = createDaemonDataStore({
      getClient: () => createClient({ listProjects }),
      now: () => 200,
    });

    await store.getState().loadProjects("host-a");
    expect(store.getState().byHost.get("host-a")?.projects).toEqual({
      loading: false,
      error: "daemon unavailable",
      data: [],
      lastUpdated: null,
    });

    await store.getState().loadProjects("host-a");
    expect(store.getState().byHost.get("host-a")?.projects).toEqual({
      loading: false,
      error: null,
      data: [project("recovered")],
      lastUpdated: 200,
    });
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  test("does not let an older concurrent request overwrite newer data", async () => {
    const older = deferred<ProjectListResult>();
    const newer = deferred<ProjectListResult>();
    const listProjects = vi
      .fn<DaemonDataClient["listProjects"]>()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const store = createDaemonDataStore({
      getClient: () => createClient({ listProjects }),
      now: () => 300,
    });

    const olderRequest = store.getState().refreshProjects("host-a");
    const newerRequest = store.getState().refreshProjects("host-a");
    newer.resolve(projectResult(project("new")));
    await newerRequest;
    older.resolve(projectResult(project("old")));
    await olderRequest;

    expect(store.getState().byHost.get("host-a")?.projects).toEqual({
      loading: false,
      error: null,
      data: [project("new")],
      lastUpdated: 300,
    });
  });
});

function agentEntry(agentId: string, projectId: string, status = "idle"): DaemonAgentEntry {
  return {
    agent: {
      id: agentId,
      provider: "claude",
      cwd: `/projects/${projectId}`,
      model: null,
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: "2026-08-10T00:00:00Z",
      lastUserMessageAt: null,
      status: status as DaemonAgentEntry["agent"]["status"],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: false,
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
      projectKey: projectId,
      projectName: `Project ${projectId}`,
      workspaceName: null,
      checkout: {
        cwd: `/projects/${projectId}`,
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

function agentResult(...entries: DaemonAgentEntry[]): AgentListResult {
  return {
    requestId: "req-agents",
    entries,
    pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
  };
}

function workspace(id: string, projectId: string): DaemonWorkspace {
  return {
    id,
    projectId,
    projectDisplayName: `Project ${projectId}`,
    projectCustomName: null,
    projectCustomIconRevision: null,
    projectRootPath: `/projects/${projectId}`,
    workspaceDirectory: `/projects/${projectId}`,
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: id,
    title: null,
    pinnedAt: null,
    archivingAt: null,
    status: "idle" as DaemonWorkspace["status"],
    statusEnteredAt: null,
    activityAt: null,
    diffStat: null,
    scripts: [],
    gitRuntime: { kind: "unavailable" } as DaemonWorkspace["gitRuntime"],
    githubRuntime: { kind: "unavailable" } as DaemonWorkspace["githubRuntime"],
  };
}

describe("daemon data store live updates", () => {
  async function loadedStore(options: {
    agents?: DaemonAgentEntry[];
    projects?: DaemonProject[];
    workspaces?: DaemonWorkspace[];
    fetchAgents?: DaemonDataClient["fetchAgents"];
  }) {
    const fetchAgents = options.fetchAgents ?? (async () => agentResult(...(options.agents ?? [])));
    const store = createDaemonDataStore({
      getClient: () =>
        createClient({
          listProjects: async () => projectResult(...(options.projects ?? [])),
          fetchWorkspaces: async () => ({
            ...emptyWorkspaceResult(),
            entries: options.workspaces ?? [],
          }),
          fetchAgents,
        }),
      now: () => 500,
    });
    await store.getState().loadHost("host-a");
    return store;
  }

  test("agent upsert replaces the snapshot and keeps the placement when omitted", async () => {
    const entry = agentEntry("agent-1", "proj");
    const store = await loadedStore({ agents: [entry] });

    store.getState().applyAgentUpdate("host-a", {
      kind: "upsert",
      agent: { ...entry.agent, status: "running" as DaemonAgentEntry["agent"]["status"] },
    });

    const agents = store.getState().byHost.get("host-a")?.agents.data;
    expect(agents).toHaveLength(1);
    expect(agents?.[0].agent.status).toBe("running");
    expect(agents?.[0].project).toEqual(entry.project);
  });

  test("agent upsert with a placement adds an unknown agent", async () => {
    const store = await loadedStore({ agents: [] });
    const entry = agentEntry("agent-new", "proj");

    store.getState().applyAgentUpdate("host-a", {
      kind: "upsert",
      agent: entry.agent,
      project: entry.project,
    });

    expect(store.getState().byHost.get("host-a")?.agents.data).toEqual([entry]);
  });

  test("agent upsert without a placement for an unknown agent refetches the list", async () => {
    const entry = agentEntry("agent-new", "proj");
    const fetchAgents = vi
      .fn<DaemonDataClient["fetchAgents"]>()
      .mockResolvedValueOnce(agentResult())
      .mockResolvedValueOnce(agentResult(entry));
    const store = await loadedStore({ fetchAgents });

    store.getState().applyAgentUpdate("host-a", { kind: "upsert", agent: entry.agent });
    await vi.waitFor(() => {
      expect(store.getState().byHost.get("host-a")?.agents.data).toEqual([entry]);
    });
    expect(fetchAgents).toHaveBeenCalledTimes(2);
  });

  test("agent remove drops the entry", async () => {
    const store = await loadedStore({ agents: [agentEntry("agent-1", "proj")] });

    store.getState().applyAgentUpdate("host-a", { kind: "remove", agentId: "agent-1" });

    expect(store.getState().byHost.get("host-a")?.agents.data).toEqual([]);
  });

  test("project upsert and remove edit the project list", async () => {
    const store = await loadedStore({ projects: [project("keep"), project("gone")] });

    store.getState().applyProjectUpdate("host-a", {
      kind: "upsert",
      project: { ...project("keep"), projectDisplayName: "Renamed" },
    });
    store.getState().applyProjectUpdate("host-a", { kind: "remove", projectId: "gone" });

    const projects = store.getState().byHost.get("host-a")?.projects.data;
    expect(projects?.map((p) => p.projectId)).toEqual(["keep"]);
    expect(projects?.[0].projectDisplayName).toBe("Renamed");
  });

  test("workspace remove can carry project changes", async () => {
    const store = await loadedStore({
      projects: [project("stale")],
      workspaces: [workspace("ws-1", "stale")],
    });

    store.getState().applyWorkspaceUpdate("host-a", {
      kind: "remove",
      id: "ws-1",
      emptyProject: project("kept-empty"),
      removedProjectId: "stale",
    });

    const host = store.getState().byHost.get("host-a");
    expect(host?.workspaces.data).toEqual([]);
    expect(host?.projects.data.map((p) => p.projectId)).toEqual(["kept-empty"]);
  });

  test("workspace upsert replaces or appends the entry", async () => {
    const store = await loadedStore({ workspaces: [workspace("ws-1", "proj")] });

    store.getState().applyWorkspaceUpdate("host-a", {
      kind: "upsert",
      workspace: { ...workspace("ws-1", "proj"), name: "renamed" },
    });
    store.getState().applyWorkspaceUpdate("host-a", {
      kind: "upsert",
      workspace: workspace("ws-2", "proj"),
    });

    const names = store
      .getState()
      .byHost.get("host-a")
      ?.workspaces.data.map((w) => w.name);
    expect(names).toEqual(["renamed", "ws-2"]);
  });

  test("updates for hosts without loaded data are ignored", async () => {
    const store = await loadedStore({ agents: [] });

    store.getState().applyAgentUpdate("host-unknown", {
      kind: "remove",
      agentId: "agent-1",
    });

    expect(store.getState().byHost.has("host-unknown")).toBe(false);
  });
});
