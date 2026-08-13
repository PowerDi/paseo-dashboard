import type { Host } from "@getpaseo/dashboard-shared";
import type { DashboardHostRuntimeState } from "../paseo/dashboardRuntime";
import type { DaemonAgentEntry } from "../stores/daemon-data-store";

/**
 * Pure builders that turn Dashboard hosts + per-host daemon data into the
 * view models the sidebar and pages render. Grouping key is the project id:
 * agent placements carry it in `projectKey` (the daemon fills that field
 * with `project.projectId`, see packages/server/src/server/session.ts), and
 * project descriptors carry it in `projectId`. Projects without agents come
 * from the project list so the tree still shows them.
 */

export type HostPresence = "online" | "connecting" | "offline";
export type SessionStatus = "running" | "idle" | "error";

export interface SidebarSessionNode {
  id: string;
  hostId: string;
  /** Null when the agent has no title yet; the UI supplies the fallback. */
  title: string | null;
  status: SessionStatus;
  provider: string;
}

export interface SidebarProjectNode {
  id: string;
  label: string;
  sessions: SidebarSessionNode[];
}

export interface SidebarHostNode {
  id: string;
  label: string;
  presence: HostPresence;
  /** Set while the daemon data is loading or failed; null when usable. */
  dataError: string | null;
  loading: boolean;
  projects: SidebarProjectNode[];
}

export interface AgentContext {
  host: Host;
  entry: DaemonAgentEntry;
}

export function hostPresence(runtime: DashboardHostRuntimeState | undefined): HostPresence {
  const status = runtime?.connection.status;
  if (status === "connected") return "online";
  if (status === "connecting") return "connecting";
  return "offline";
}

export function sessionStatus(agentStatus: string): SessionStatus {
  if (agentStatus === "running" || agentStatus === "initializing") return "running";
  if (agentStatus === "error") return "error";
  return "idle";
}

export function isActiveAgent(entry: DaemonAgentEntry): boolean {
  return !entry.agent.archivedAt;
}

export function buildHostNode(
  host: Host,
  runtime: DashboardHostRuntimeState | undefined,
): SidebarHostNode {
  const daemonData = runtime?.daemonData ?? null;
  const projects = new Map<string, SidebarProjectNode>();

  for (const project of daemonData?.projects.data ?? []) {
    const key = project.projectId;
    projects.set(key, {
      id: `${host.id}:${key}`,
      label: project.projectDisplayName,
      sessions: [],
    });
  }

  for (const entry of daemonData?.agents.data ?? []) {
    if (!isActiveAgent(entry)) continue;
    const key = entry.project.projectKey;
    let node = projects.get(key);
    if (!node) {
      node = { id: `${host.id}:${key}`, label: entry.project.projectName, sessions: [] };
      projects.set(key, node);
    }
    node.sessions.push({
      id: entry.agent.id,
      hostId: host.id,
      title: entry.agent.title,
      status: sessionStatus(entry.agent.status),
      provider: entry.agent.provider,
    });
  }

  const sorted = [...projects.values()].sort((a, b) => a.label.localeCompare(b.label));
  for (const project of sorted) {
    project.sessions.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  }

  const loading = daemonData !== null && (daemonData.projects.loading || daemonData.agents.loading);
  const dataError = daemonData?.projects.error ?? daemonData?.agents.error ?? null;

  return {
    id: host.id,
    label: host.label,
    presence: hostPresence(runtime),
    dataError,
    loading,
    projects: sorted,
  };
}

export function buildHostNodes(
  hosts: readonly Host[],
  runtimes: ReadonlyMap<string, DashboardHostRuntimeState>,
): SidebarHostNode[] {
  return [...hosts]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((host) => buildHostNode(host, runtimes.get(host.id)));
}

export function findAgentContext(
  hosts: readonly Host[],
  runtimes: ReadonlyMap<string, DashboardHostRuntimeState>,
  hostId: string,
  agentId: string,
): AgentContext | null {
  const host = hosts.find((candidate) => candidate.id === hostId);
  if (!host) return null;
  const entry = runtimes
    .get(hostId)
    ?.daemonData?.agents.data.find((candidate) => candidate.agent.id === agentId);
  if (!entry) return null;
  return { host, entry };
}

export interface AgentListRow {
  hostId: string;
  hostLabel: string;
  entry: DaemonAgentEntry;
}

export function buildAgentRows(
  hosts: readonly Host[],
  runtimes: ReadonlyMap<string, DashboardHostRuntimeState>,
): AgentListRow[] {
  const rows: AgentListRow[] = [];
  for (const host of hosts) {
    const entries = runtimes.get(host.id)?.daemonData?.agents.data ?? [];
    for (const entry of entries) {
      if (!isActiveAgent(entry)) continue;
      rows.push({ hostId: host.id, hostLabel: host.label, entry });
    }
  }
  return rows.sort(
    (a, b) =>
      Date.parse(b.entry.agent.updatedAt || b.entry.agent.createdAt) -
      Date.parse(a.entry.agent.updatedAt || a.entry.agent.createdAt),
  );
}
