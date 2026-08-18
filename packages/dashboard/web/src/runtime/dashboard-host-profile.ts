import type { Host as DashboardHost } from "@getpaseo/dashboard-shared";
import { defaultHostAppearance } from "@/hosts/appearance";
import { defaultLifecycle, type HostProfile } from "@/types/host-connection";

export function dashboardHostToProfile(host: DashboardHost, existing?: HostProfile): HostProfile {
  const connectionId = `relay:${host.connection.serverId}`;
  return {
    serverId: host.connection.serverId,
    label: host.label,
    appearance: existing?.appearance ?? defaultHostAppearance(),
    lifecycle: existing?.lifecycle ?? defaultLifecycle(),
    connections: [
      {
        id: connectionId,
        type: "relay",
        relayEndpoint: host.connection.relayEndpoint,
        useTls: host.connection.useTls,
        daemonPublicKeyB64: host.connection.daemonPublicKeyB64,
      },
    ],
    preferredConnectionId: connectionId,
    createdAt: host.createdAt,
    updatedAt: host.updatedAt,
  };
}
