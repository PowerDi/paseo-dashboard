import { useMemo } from "react";
import { useDashboardSessionStore, type DashboardSessionStore } from "@/dashboard";
import { dashboardHostToProfile } from "./dashboard-host-profile";
import { getHostRuntimeStore, type HostRuntimeStore } from "./host-runtime";

function findAccountHost(session: DashboardSessionStore, serverId: string) {
  const host = session
    .getSnapshot()
    .hosts.find((candidate) => candidate.connection.serverId === serverId);
  if (!host) {
    throw new Error(`Dashboard account Host not found: ${serverId}`);
  }
  return host;
}

export function replaceRuntimeWithDashboardAccountHosts(
  session: DashboardSessionStore,
  runtime: HostRuntimeStore = getHostRuntimeStore(),
): void {
  const currentByServerId = new Map(runtime.getHosts().map((host) => [host.serverId, host]));
  runtime.replaceDashboardAccountHosts(
    session
      .getSnapshot()
      .hosts.map((host) =>
        dashboardHostToProfile(host, currentByServerId.get(host.connection.serverId)),
      ),
  );
}

export function useDashboardHostMutations() {
  const session = useDashboardSessionStore();
  const runtime = getHostRuntimeStore();

  return useMemo(
    () => ({
      renameHost: async (serverId: string, label: string) => {
        const host = findAccountHost(session, serverId);
        await session.updateHost(host.id, { label, baseVersion: host.version });
        replaceRuntimeWithDashboardAccountHosts(session, runtime);
      },
      removeHost: async (serverId: string) => {
        const host = findAccountHost(session, serverId);
        await session.deleteHost(host.id);
        replaceRuntimeWithDashboardAccountHosts(session, runtime);
      },
      removeConnection: async (serverId: string, _connectionId?: string) => {
        const host = findAccountHost(session, serverId);
        await session.deleteHost(host.id);
        replaceRuntimeWithDashboardAccountHosts(session, runtime);
      },
    }),
    [runtime, session],
  );
}
