import type { Page } from "@/layouts/Shell";

export interface AgentRouteSelection {
  hostId: string;
  agentId: string;
}

export interface DashboardRoute {
  page: Page;
  selection: AgentRouteSelection | null;
}

export const pagePaths: Record<Page, string> = {
  workspace: "/workspace",
  hosts: "/hosts",
  agents: "/agents",
  devices: "/devices",
  audit: "/audit",
  settings: "/settings",
};

export function parseDashboardRoute(pathname: string): DashboardRoute | null {
  const agentMatch = /^\/agent\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (agentMatch) {
    try {
      return {
        page: "workspace",
        selection: {
          hostId: decodeURIComponent(agentMatch[1]),
          agentId: decodeURIComponent(agentMatch[2]),
        },
      };
    } catch {
      return null;
    }
  }

  const page = (Object.entries(pagePaths) as [Page, string][]).find(
    ([, path]) => path === pathname,
  )?.[0];
  return page ? { page, selection: null } : null;
}

export function agentPath(hostId: string, agentId: string): string {
  return `/agent/${encodeURIComponent(hostId)}/${encodeURIComponent(agentId)}`;
}
