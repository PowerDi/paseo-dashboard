import type { Host } from "@getpaseo/dashboard-shared";
import { describe, expect, it } from "vitest";
import type { DashboardHostRuntimeState } from "../paseo/dashboardRuntime";
import {
  createDaemonHostDataState,
  type DaemonAgentEntry,
  type DaemonHostDataState,
  type DaemonProject,
} from "../stores/daemon-data-store";
import {
  buildAgentRows,
  buildHostNode,
  buildHostNodes,
  findAgentContext,
  hostPresence,
  sessionStatus,
} from "./agent-tree";

function makeHost(id: string, label: string): Host {
  return {
    id,
    label,
    version: 1,
    connection: {
      type: "relay",
      serverId: `srv-${id}`,
      relayEndpoint: "relay.example.com",
      useTls: true,
      daemonPublicKeyB64: "pk",
    },
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  };
}

// The descriptor's projectKey intentionally differs from projectId: the
// daemon fills agent placements with projectId, so grouping must ignore the
// descriptor's own projectKey.
function makeProject(projectId: string, name: string): DaemonProject {
  return {
    projectId,
    projectKey: `key-${projectId}`,
    projectDisplayName: name,
    projectCustomName: null,
    projectRootPath: `/home/user/${projectId}`,
    projectKind: "git",
  };
}

function makeAgentEntry(options: {
  id: string;
  projectKey: string;
  projectName: string;
  title?: string | null;
  status?: string;
  archivedAt?: string | null;
  updatedAt?: string;
}): DaemonAgentEntry {
  return {
    agent: {
      id: options.id,
      provider: "claude",
      cwd: `/home/user/${options.projectKey}`,
      model: null,
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: options.updatedAt ?? "2026-08-10T00:00:00Z",
      lastUserMessageAt: null,
      status: (options.status ?? "idle") as DaemonAgentEntry["agent"]["status"],
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
      title: options.title ?? null,
      labels: {},
      archivedAt: options.archivedAt ?? null,
    },
    project: {
      projectKey: options.projectKey,
      projectName: options.projectName,
      workspaceName: null,
      checkout: {
        cwd: `/home/user/${options.projectKey}`,
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

function makeRuntime(options: {
  connectionStatus?: "connected" | "connecting" | "idle";
  projects?: DaemonProject[];
  agents?: DaemonAgentEntry[];
  agentsError?: string;
}): DashboardHostRuntimeState {
  const daemonData: DaemonHostDataState = createDaemonHostDataState();
  const data: DaemonHostDataState = {
    ...daemonData,
    projects: {
      ...daemonData.projects,
      data: options.projects ?? [],
      lastUpdated: 1,
    },
    agents: {
      ...daemonData.agents,
      data: options.agents ?? [],
      error: options.agentsError ?? null,
      lastUpdated: 1,
    },
  };
  const status = options.connectionStatus ?? "connected";
  return {
    connection: status === "connecting" ? { status, attempt: 1 } : { status },
    daemonData: data,
  };
}

describe("presence and status mapping", () => {
  it("maps connection state to presence", () => {
    expect(hostPresence(makeRuntime({ connectionStatus: "connected" }))).toBe("online");
    expect(hostPresence(makeRuntime({ connectionStatus: "connecting" }))).toBe("connecting");
    expect(hostPresence(makeRuntime({ connectionStatus: "idle" }))).toBe("offline");
    expect(hostPresence(undefined)).toBe("offline");
  });

  it("maps agent lifecycle to session status", () => {
    expect(sessionStatus("running")).toBe("running");
    expect(sessionStatus("initializing")).toBe("running");
    expect(sessionStatus("error")).toBe("error");
    expect(sessionStatus("idle")).toBe("idle");
    expect(sessionStatus("closed")).toBe("idle");
  });
});

describe("buildHostNode", () => {
  it("groups agents under their project and keeps agent-less projects", () => {
    const host = makeHost("h1", "工作站");
    const runtime = makeRuntime({
      projects: [makeProject("paseo", "paseo"), makeProject("zeno", "zeno")],
      agents: [
        makeAgentEntry({ id: "a1", projectKey: "paseo", projectName: "paseo", title: "修复认证" }),
        makeAgentEntry({ id: "a2", projectKey: "paseo", projectName: "paseo", status: "running" }),
      ],
    });

    const node = buildHostNode(host, runtime);

    expect(node.presence).toBe("online");
    expect(node.projects.map((project) => project.label)).toEqual(["paseo", "zeno"]);
    expect(node.projects[0].sessions).toHaveLength(2);
    expect(node.projects[1].sessions).toHaveLength(0);
  });

  it("creates a project row from agent placement when the project list misses it", () => {
    const host = makeHost("h1", "工作站");
    const runtime = makeRuntime({
      agents: [makeAgentEntry({ id: "a1", projectKey: "ghost", projectName: "ghost-project" })],
    });

    const node = buildHostNode(host, runtime);

    expect(node.projects).toHaveLength(1);
    expect(node.projects[0].label).toBe("ghost-project");
  });

  it("excludes archived agents", () => {
    const host = makeHost("h1", "工作站");
    const runtime = makeRuntime({
      agents: [
        makeAgentEntry({ id: "a1", projectKey: "p", projectName: "p" }),
        makeAgentEntry({
          id: "a2",
          projectKey: "p",
          projectName: "p",
          archivedAt: "2026-08-11T00:00:00Z",
        }),
      ],
    });

    const node = buildHostNode(host, runtime);

    expect(node.projects[0].sessions.map((session) => session.id)).toEqual(["a1"]);
  });

  it("surfaces the daemon data error", () => {
    const host = makeHost("h1", "工作站");
    const runtime = makeRuntime({ agentsError: "fetch failed" });

    expect(buildHostNode(host, runtime).dataError).toBe("fetch failed");
    expect(buildHostNode(host, undefined).dataError).toBeNull();
  });
});

describe("buildAgentRows and findAgentContext", () => {
  it("flattens agents across hosts sorted by recency", () => {
    const hosts = [makeHost("h1", "A"), makeHost("h2", "B")];
    const runtimes = new Map([
      [
        "h1",
        makeRuntime({
          agents: [
            makeAgentEntry({
              id: "old",
              projectKey: "p",
              projectName: "p",
              updatedAt: "2026-08-01T00:00:00Z",
            }),
          ],
        }),
      ],
      [
        "h2",
        makeRuntime({
          agents: [
            makeAgentEntry({
              id: "new",
              projectKey: "p",
              projectName: "p",
              updatedAt: "2026-08-12T00:00:00Z",
            }),
          ],
        }),
      ],
    ]);

    const rows = buildAgentRows(hosts, runtimes);

    expect(rows.map((row) => row.entry.agent.id)).toEqual(["new", "old"]);
    expect(rows[0].hostLabel).toBe("B");
  });

  it("finds the selected agent context", () => {
    const hosts = [makeHost("h1", "A")];
    const runtimes = new Map([
      [
        "h1",
        makeRuntime({ agents: [makeAgentEntry({ id: "a1", projectKey: "p", projectName: "p" })] }),
      ],
    ]);

    expect(findAgentContext(hosts, runtimes, "h1", "a1")?.entry.agent.id).toBe("a1");
    expect(findAgentContext(hosts, runtimes, "h1", "missing")).toBeNull();
    expect(findAgentContext(hosts, runtimes, "missing", "a1")).toBeNull();
  });

  it("orders hosts by label in the sidebar tree", () => {
    const nodes = buildHostNodes([makeHost("h2", "笔记本"), makeHost("h1", "工作站")], new Map());
    expect(nodes.map((node) => node.label)).toEqual(["工作站", "笔记本"]);
  });
});
