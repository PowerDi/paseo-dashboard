import type { TimelineEntry } from "../stores/timeline-store";
import type { SessionStatus } from "./agent-tree";
import { toolCallSummary } from "./tool-call";

export interface LiveActivity {
  /** "tool" when the newest entry is a tool call still running. */
  phase: "replying" | "tool";
  /** Tool summary line; only present for phase "tool". */
  detail?: string;
  /** Epoch ms the current turn began (the last user message), for the elapsed counter. */
  startedAt?: number;
}

/**
 * What to show at the tail of the timeline while the agent works.
 *
 * The daemon only reports running/idle/error, so the phase is inferred from the
 * newest entry rather than from a dedicated stream event.
 */
export function deriveLiveActivity(input: {
  status: SessionStatus;
  entries: readonly TimelineEntry[];
}): LiveActivity | null {
  if (input.status !== "running") return null;

  const startedAt = currentTurnStartedAt(input.entries);
  const base = startedAt === undefined ? {} : { startedAt };
  const last = input.entries[input.entries.length - 1];

  // If the last entry is a completed assistant message, the turn is done even
  // if the daemon's agent_update hasn't fired yet to flip status to idle.
  if (last?.item.type === "assistant_message") return null;

  if (last?.item.type === "tool_call" && last.item.status === "running") {
    return { phase: "tool", detail: toolCallSummary(last.item.name, last.item.detail), ...base };
  }
  return { phase: "replying", ...base };
}

function currentTurnStartedAt(entries: readonly TimelineEntry[]): number | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.item.type !== "user_message") continue;
    const parsed = Date.parse(entry.timestamp);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}
