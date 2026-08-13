import { useCallback, useEffect, useState } from "react";
import { dashboardRuntime } from "@/paseo/dashboardRuntime";
import type { AgentTimelineState } from "@/stores/timeline-store";

/**
 * Marks the agent as viewed for the lifetime of the subscription (selective
 * stream + tail load on mount, unsubscribe on unmount) and re-renders on
 * timeline changes.
 */
export function useAgentTimeline(
  hostId: string | null,
  agentId: string | null,
): { timeline: AgentTimelineState | null; loadOlder: () => void } {
  const [timeline, setTimeline] = useState<AgentTimelineState | null>(null);

  useEffect(() => {
    if (!hostId || !agentId) {
      setTimeline(null);
      return;
    }
    const unsubscribe = dashboardRuntime.subscribeTimeline(hostId, agentId, setTimeline);
    void dashboardRuntime.viewAgent(hostId, agentId).catch(() => undefined);
    return () => {
      unsubscribe();
      void dashboardRuntime.leaveAgent(hostId, agentId).catch(() => undefined);
    };
  }, [hostId, agentId]);

  const loadOlder = useCallback(() => {
    if (!hostId || !agentId) return;
    void dashboardRuntime.loadOlderTimeline(hostId, agentId).catch(() => undefined);
  }, [hostId, agentId]);

  return { timeline, loadOlder };
}
