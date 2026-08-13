import type {
  AgentUpdateMessage,
  FetchAgentsResponseMessage,
  FetchWorkspacesResponseMessage,
  ProjectListResponseMessage,
  ProjectUpdateMessageSchema,
  WorkspaceProjectDescriptorPayload,
  WorkspaceUpdateMessageSchema,
} from "@getpaseo/protocol/messages";
import type { z } from "zod";
import { createStore, type StoreApi } from "zustand/vanilla";

const PAGE_LIMIT = 200;

export type DaemonProject = WorkspaceProjectDescriptorPayload;
export type DaemonWorkspace = FetchWorkspacesResponseMessage["payload"]["entries"][number];
export type DaemonAgentEntry = FetchAgentsResponseMessage["payload"]["entries"][number];
export type DaemonAgentUpdate = AgentUpdateMessage["payload"];
export type DaemonWorkspaceUpdate = z.infer<typeof WorkspaceUpdateMessageSchema>["payload"];
export type DaemonProjectUpdate = z.infer<typeof ProjectUpdateMessageSchema>["payload"];

interface PageOptions {
  page?: {
    limit: number;
    cursor?: string;
  };
}

export interface DaemonDataClient {
  listProjects(requestId?: string): Promise<ProjectListResponseMessage["payload"]>;
  fetchWorkspaces(options?: PageOptions): Promise<FetchWorkspacesResponseMessage["payload"]>;
  fetchAgents(options?: PageOptions): Promise<FetchAgentsResponseMessage["payload"]>;
}

export interface DaemonResourceState<T> {
  loading: boolean;
  error: string | null;
  data: readonly T[];
  lastUpdated: number | null;
}

export interface DaemonHostDataState {
  projects: DaemonResourceState<DaemonProject>;
  workspaces: DaemonResourceState<DaemonWorkspace>;
  agents: DaemonResourceState<DaemonAgentEntry>;
}

export interface DaemonDataStoreState {
  byHost: Map<string, DaemonHostDataState>;
  loadHost(hostId: string): Promise<void>;
  refreshHost(hostId: string): Promise<void>;
  loadProjects(hostId: string): Promise<void>;
  refreshProjects(hostId: string): Promise<void>;
  loadWorkspaces(hostId: string): Promise<void>;
  refreshWorkspaces(hostId: string): Promise<void>;
  loadAgents(hostId: string): Promise<void>;
  refreshAgents(hostId: string): Promise<void>;
  applyAgentUpdate(hostId: string, update: DaemonAgentUpdate): void;
  applyWorkspaceUpdate(hostId: string, update: DaemonWorkspaceUpdate): void;
  applyProjectUpdate(hostId: string, update: DaemonProjectUpdate): void;
  clearHost(hostId: string): void;
  clear(): void;
}

export interface DaemonDataStoreDependencies {
  getClient(hostId: string): DaemonDataClient | null;
  now?: () => number;
}

interface RequestVersions {
  projects: number;
  workspaces: number;
  agents: number;
}

function createResourceState<T>(): DaemonResourceState<T> {
  return {
    loading: false,
    error: null,
    data: [],
    lastUpdated: null,
  };
}

export function createDaemonHostDataState(): DaemonHostDataState {
  return {
    projects: createResourceState<DaemonProject>(),
    workspaces: createResourceState<DaemonWorkspace>(),
    agents: createResourceState<DaemonAgentEntry>(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireClient(
  getClient: DaemonDataStoreDependencies["getClient"],
  hostId: string,
): DaemonDataClient {
  const client = getClient(hostId);
  if (!client) {
    throw new Error(`No daemon client available for host ${hostId}`);
  }
  return client;
}

function updateHost(
  byHost: Map<string, DaemonHostDataState>,
  hostId: string,
  update: (host: DaemonHostDataState) => DaemonHostDataState,
): Map<string, DaemonHostDataState> {
  const next = new Map(byHost);
  next.set(hostId, update(byHost.get(hostId) ?? createDaemonHostDataState()));
  return next;
}

export function createDaemonDataStore(
  dependencies: DaemonDataStoreDependencies,
): StoreApi<DaemonDataStoreState> {
  const now = dependencies.now ?? Date.now;
  const requestVersions = new Map<string, RequestVersions>();
  let nextRequestVersion = 0;

  function beginRequest(hostId: string, resource: keyof RequestVersions): number {
    const version = ++nextRequestVersion;
    const current = requestVersions.get(hostId) ?? {
      projects: 0,
      workspaces: 0,
      agents: 0,
    };
    requestVersions.set(hostId, { ...current, [resource]: version });
    return version;
  }

  function isCurrentRequest(
    hostId: string,
    resource: keyof RequestVersions,
    version: number,
  ): boolean {
    return requestVersions.get(hostId)?.[resource] === version;
  }

  function invalidateHost(hostId: string): void {
    requestVersions.set(hostId, {
      projects: ++nextRequestVersion,
      workspaces: ++nextRequestVersion,
      agents: ++nextRequestVersion,
    });
  }

  return createStore<DaemonDataStoreState>((set, get) => {
    async function refreshProjects(hostId: string): Promise<void> {
      const version = beginRequest(hostId, "projects");
      set((state) => ({
        byHost: updateHost(state.byHost, hostId, (host) => ({
          ...host,
          projects: { ...host.projects, loading: true, error: null },
        })),
      }));

      try {
        const response = await requireClient(dependencies.getClient, hostId).listProjects();
        if (!isCurrentRequest(hostId, "projects", version)) return;
        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (host) => ({
            ...host,
            projects: {
              loading: false,
              error: null,
              data: response.projects,
              lastUpdated: now(),
            },
          })),
        }));
      } catch (error) {
        if (!isCurrentRequest(hostId, "projects", version)) return;
        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (host) => ({
            ...host,
            projects: { ...host.projects, loading: false, error: errorMessage(error) },
          })),
        }));
      }
    }

    async function refreshWorkspaces(hostId: string): Promise<void> {
      const version = beginRequest(hostId, "workspaces");
      set((state) => ({
        byHost: updateHost(state.byHost, hostId, (host) => ({
          ...host,
          workspaces: { ...host.workspaces, loading: true, error: null },
        })),
      }));

      try {
        const client = requireClient(dependencies.getClient, hostId);
        const entries: DaemonWorkspace[] = [];
        let cursor: string | undefined;
        do {
          const response = await client.fetchWorkspaces({
            page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
          });
          if (!isCurrentRequest(hostId, "workspaces", version)) return;
          entries.push(...response.entries);
          cursor = response.pageInfo.nextCursor ?? undefined;
        } while (cursor);

        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (host) => ({
            ...host,
            workspaces: {
              loading: false,
              error: null,
              data: entries,
              lastUpdated: now(),
            },
          })),
        }));
      } catch (error) {
        if (!isCurrentRequest(hostId, "workspaces", version)) return;
        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (host) => ({
            ...host,
            workspaces: { ...host.workspaces, loading: false, error: errorMessage(error) },
          })),
        }));
      }
    }

    async function refreshAgents(hostId: string): Promise<void> {
      const version = beginRequest(hostId, "agents");
      set((state) => ({
        byHost: updateHost(state.byHost, hostId, (host) => ({
          ...host,
          agents: { ...host.agents, loading: true, error: null },
        })),
      }));

      try {
        const client = requireClient(dependencies.getClient, hostId);
        const entries: DaemonAgentEntry[] = [];
        let cursor: string | undefined;
        do {
          const response = await client.fetchAgents({
            page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
          });
          if (!isCurrentRequest(hostId, "agents", version)) return;
          entries.push(...response.entries);
          cursor = response.pageInfo.nextCursor ?? undefined;
        } while (cursor);

        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (host) => ({
            ...host,
            agents: {
              loading: false,
              error: null,
              data: entries,
              lastUpdated: now(),
            },
          })),
        }));
      } catch (error) {
        if (!isCurrentRequest(hostId, "agents", version)) return;
        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (host) => ({
            ...host,
            agents: { ...host.agents, loading: false, error: errorMessage(error) },
          })),
        }));
      }
    }

    async function loadProjects(hostId: string): Promise<void> {
      const state = get().byHost.get(hostId)?.projects;
      if (state && (state.loading || state.lastUpdated !== null)) return;
      await refreshProjects(hostId);
    }

    async function loadWorkspaces(hostId: string): Promise<void> {
      const state = get().byHost.get(hostId)?.workspaces;
      if (state && (state.loading || state.lastUpdated !== null)) return;
      await refreshWorkspaces(hostId);
    }

    async function loadAgents(hostId: string): Promise<void> {
      const state = get().byHost.get(hostId)?.agents;
      if (state && (state.loading || state.lastUpdated !== null)) return;
      await refreshAgents(hostId);
    }

    return {
      byHost: new Map(),
      loadHost: async (hostId) => {
        await Promise.all([loadProjects(hostId), loadWorkspaces(hostId), loadAgents(hostId)]);
      },
      refreshHost: async (hostId) => {
        await Promise.all([
          refreshProjects(hostId),
          refreshWorkspaces(hostId),
          refreshAgents(hostId),
        ]);
      },
      loadProjects,
      refreshProjects,
      loadWorkspaces,
      refreshWorkspaces,
      loadAgents,
      refreshAgents,
      applyAgentUpdate: (hostId, update) => {
        const host = get().byHost.get(hostId);
        // Ignore pushes for hosts that never loaded; the initial fetch will
        // pick the change up.
        if (!host) return;

        if (update.kind === "remove") {
          set((state) => ({
            byHost: updateHost(state.byHost, hostId, (hostState) => ({
              ...hostState,
              agents: {
                ...hostState.agents,
                data: hostState.agents.data.filter((entry) => entry.agent.id !== update.agentId),
                lastUpdated: now(),
              },
            })),
          }));
          return;
        }

        const existing = host.agents.data.find((entry) => entry.agent.id === update.agent.id);
        const placement = update.project ?? existing?.project ?? null;
        if (!placement) {
          // Unknown agent without placement: only a full fetch can place it in
          // the tree.
          void refreshAgents(hostId);
          return;
        }

        const nextEntry: DaemonAgentEntry = { agent: update.agent, project: placement };
        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (hostState) => ({
            ...hostState,
            agents: {
              ...hostState.agents,
              data: existing
                ? hostState.agents.data.map((entry) =>
                    entry.agent.id === update.agent.id ? nextEntry : entry,
                  )
                : [...hostState.agents.data, nextEntry],
              lastUpdated: now(),
            },
          })),
        }));
      },
      applyWorkspaceUpdate: (hostId, update) => {
        if (!get().byHost.has(hostId)) return;
        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (hostState) => {
            if (update.kind === "upsert") {
              const exists = hostState.workspaces.data.some(
                (entry) => entry.id === update.workspace.id,
              );
              return {
                ...hostState,
                workspaces: {
                  ...hostState.workspaces,
                  data: exists
                    ? hostState.workspaces.data.map((entry) =>
                        entry.id === update.workspace.id ? update.workspace : entry,
                      )
                    : [...hostState.workspaces.data, update.workspace],
                  lastUpdated: now(),
                },
              };
            }

            let projects = hostState.projects;
            if (update.removedProjectId) {
              projects = {
                ...projects,
                data: projects.data.filter(
                  (project) => project.projectId !== update.removedProjectId,
                ),
                lastUpdated: now(),
              };
            }
            if (update.emptyProject) {
              const emptyProject = update.emptyProject;
              const exists = projects.data.some(
                (project) => project.projectId === emptyProject.projectId,
              );
              projects = {
                ...projects,
                data: exists
                  ? projects.data.map((project) =>
                      project.projectId === emptyProject.projectId ? emptyProject : project,
                    )
                  : [...projects.data, emptyProject],
                lastUpdated: now(),
              };
            }
            return {
              ...hostState,
              projects,
              workspaces: {
                ...hostState.workspaces,
                data: hostState.workspaces.data.filter((entry) => entry.id !== update.id),
                lastUpdated: now(),
              },
            };
          }),
        }));
      },
      applyProjectUpdate: (hostId, update) => {
        if (!get().byHost.has(hostId)) return;
        set((state) => ({
          byHost: updateHost(state.byHost, hostId, (hostState) => {
            if (update.kind === "remove") {
              return {
                ...hostState,
                projects: {
                  ...hostState.projects,
                  data: hostState.projects.data.filter(
                    (project) => project.projectId !== update.projectId,
                  ),
                  lastUpdated: now(),
                },
              };
            }
            const exists = hostState.projects.data.some(
              (project) => project.projectId === update.project.projectId,
            );
            return {
              ...hostState,
              projects: {
                ...hostState.projects,
                data: exists
                  ? hostState.projects.data.map((project) =>
                      project.projectId === update.project.projectId ? update.project : project,
                    )
                  : [...hostState.projects.data, update.project],
                lastUpdated: now(),
              },
            };
          }),
        }));
      },
      clearHost: (hostId) => {
        invalidateHost(hostId);
        set((state) => {
          const byHost = new Map(state.byHost);
          byHost.delete(hostId);
          return { byHost };
        });
      },
      clear: () => {
        for (const hostId of get().byHost.keys()) invalidateHost(hostId);
        set({ byHost: new Map() });
      },
    };
  });
}
