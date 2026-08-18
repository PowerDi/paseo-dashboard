import { useEffect, useMemo } from "react";
import { useDashboardSessionSnapshot } from "@/dashboard";
import { getHostRuntimeStore } from "./host-runtime";

import { dashboardHostToProfile } from "./dashboard-host-profile";

/**
 * Keeps the copied App runtime fed only by the authenticated Dashboard account.
 * This component must stay mounted outside DashboardLoginGate so logout and 401
 * transitions can disconnect the previous account before the login screen appears.
 */
export function DashboardAccountHostRuntimeBridge() {
  const session = useDashboardSessionSnapshot();
  const runtime = getHostRuntimeStore();
  const profiles = useMemo(() => {
    const currentByServerId = new Map(runtime.getHosts().map((host) => [host.serverId, host]));
    return session.hosts.map((host) =>
      dashboardHostToProfile(host, currentByServerId.get(host.connection.serverId)),
    );
  }, [runtime, session.hosts]);

  useEffect(() => {
    if (session.authStatus === "authenticated" && session.hostsStatus === "ready") {
      runtime.replaceDashboardAccountHosts(profiles);
      return;
    }

    if (session.authStatus === "anonymous") {
      void runtime.clearDashboardAccountHosts().catch((error) => {
        console.warn("[Dashboard] Failed to clear account Hosts", error);
      });
    }
  }, [profiles, runtime, session.authStatus, session.hostsStatus]);

  return null;
}
