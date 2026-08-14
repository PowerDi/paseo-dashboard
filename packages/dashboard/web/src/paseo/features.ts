import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";

/**
 * Dashboard feature capability detection based on daemon server_info.features.
 *
 * Each function checks one feature flag. When a feature is missing, the calling
 * code either hides the UI or tells the user to update the host. No fallback
 * paths — the user updates or doesn't get the feature.
 *
 * See /root/workspace/code/paseo/docs/protocol-compatibility.md for the contract.
 */

export interface DaemonFeatures {
  /**
   * Selective agent timeline: daemon only streams timeline events for agents
   * the client explicitly subscribes to via setAgentTimelineSubscription.
   * Added in v0.1.106.
   */
  selectiveAgentTimeline: boolean;

  /**
   * Terminal restore modes: daemon accepts restore options (mode, scrollbackLines)
   * when subscribing to a terminal, instead of always sending a snapshot frame.
   * Added in v0.1.81.
   */
  terminalRestoreModes: boolean;

  /**
   * Agent config apply: daemon supports applying a config bundle (modelId,
   * modeId, thinkingOptionId, featureValues) to an existing agent via
   * agent.config.apply RPC. Added in v0.3.2.
   */
  agentConfigApply: boolean;
}

/**
 * Extracts Dashboard-relevant feature flags from server_info. Returns false
 * for any feature not advertised by the daemon (old daemon = no flag = no support).
 */
export function getDaemonFeatures(serverInfo: ServerInfoStatusPayload | null): DaemonFeatures {
  const features = serverInfo?.features ?? {};
  return {
    selectiveAgentTimeline: features.selectiveAgentTimeline === true,
    terminalRestoreModes: features["terminal-restore-modes"] === true,
    agentConfigApply: features.agentConfigApply === true,
  };
}

/**
 * Returns true if the daemon supports all features Dashboard currently uses.
 * Add new required features here as Dashboard adopts them.
 */
export function isCompatibleDaemon(_serverInfo: ServerInfoStatusPayload | null): boolean {
  // Currently Dashboard gracefully degrades when features are missing,
  // so we don't block connection. Future breaking changes would add checks here.
  return true;
}
