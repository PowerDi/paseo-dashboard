import type { TimelineEntry } from "../stores/timeline-store";
import type { SessionStatus } from "./agent-tree";
import { toolCallSummary } from "./tool-call";

export type LiveActivityPhase = "thinking" | "tool";

export interface LiveActivity {
  /** "tool" when the newest entry is a tool call still running. */
  phase: LiveActivityPhase;
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
  pendingPrompt?: { startedAt: number };
}): LiveActivity | null {
  if (input.pendingPrompt) return { phase: "thinking", startedAt: input.pendingPrompt.startedAt };
  if (input.status !== "running") return null;

  const startedAt = currentTurnStartedAt(input.entries);
  const base = startedAt === undefined ? {} : { startedAt };
  const last = input.entries[input.entries.length - 1];

  // Keep the activity row while assistant text is arriving. The timeline and
  // agent status do not update in the same render, so removing it here creates
  // a visible gap before the newly fetched text paints.
  if (last?.item.type === "assistant_message") return { phase: "thinking", ...base };

  if (last?.item.type === "reasoning") return { phase: "thinking", ...base };

  if (last?.item.type === "tool_call" && last.item.status === "running") {
    return { phase: "tool", detail: toolCallSummary(last.item.name, last.item.detail), ...base };
  }
  return { phase: "thinking", ...base };
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
