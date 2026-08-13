import type { Host } from "@getpaseo/dashboard-shared";
import { useEffect, useState } from "react";
import {
  dashboardRuntime,
  type DashboardHostRuntimeState,
  type DashboardPaseoRuntime,
} from "../paseo/dashboardRuntime";

/**
 * Subscribes to the runtime state (connection + daemon data) of every host in
 * the list. Re-renders when any host's state changes; hosts leaving the list
 * are unsubscribed and dropped from the map.
 */
export function useHostRuntimes(
  hosts: readonly Host[],
  runtime: DashboardPaseoRuntime = dashboardRuntime,
): ReadonlyMap<string, DashboardHostRuntimeState> {
  // A joined key keeps the effect stable across re-renders that rebuild the
  // hosts array without changing its membership.
  const hostIdsKey = hosts
    .map((host) => host.id)
    .sort()
    .join("\n");
  const [states, setStates] = useState<ReadonlyMap<string, DashboardHostRuntimeState>>(new Map());

  useEffect(() => {
    const hostIds = hostIdsKey ? hostIdsKey.split("\n") : [];
    const idSet = new Set(hostIds);

    setStates((previous) => {
      const next = new Map<string, DashboardHostRuntimeState>();
      for (const [hostId, state] of previous) {
        if (idSet.has(hostId)) next.set(hostId, state);
      }
      return next.size === previous.size ? previous : next;
    });

    const unsubscribes = hostIds.map((hostId) =>
      runtime.subscribe(hostId, (state) => {
        setStates((previous) => {
          const next = new Map(previous);
          next.set(hostId, state);
          return next;
        });
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [hostIdsKey, runtime]);

  return states;
}
