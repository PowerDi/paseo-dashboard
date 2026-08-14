import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../stores/timeline-store";
import { deriveLiveActivity } from "./live-activity";

function entry(item: TimelineEntry["item"], timestamp: string, seq: number): TimelineEntry {
  return {
    provider: "codex",
    item,
    timestamp,
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    collapsed: [],
  };
}

describe("deriveLiveActivity", () => {
  it("returns null unless the agent is running", () => {
    const entries = [entry({ type: "user_message", text: "hi" }, "2026-08-13T10:00:00.000Z", 1)];
    expect(deriveLiveActivity({ status: "idle", entries })).toBeNull();
    expect(deriveLiveActivity({ status: "error", entries })).toBeNull();
  });

  it("returns null when the newest entry is a completed assistant message", () => {
    const activity = deriveLiveActivity({
      status: "running",
      entries: [
        entry({ type: "user_message", text: "hi" }, "2026-08-13T10:00:00.000Z", 1),
        entry({ type: "assistant_message", text: "on it" }, "2026-08-13T10:00:05.000Z", 2),
      ],
    });
    // Even though status is still "running" (daemon hasn't sent agent_update yet),
    // a completed assistant message means the turn is done.
    expect(activity).toBeNull();
  });

  it("surfaces the command of a running tool call", () => {
    const activity = deriveLiveActivity({
      status: "running",
      entries: [
        entry({ type: "user_message", text: "build" }, "2026-08-13T10:00:00.000Z", 1),
        entry(
          {
            type: "tool_call",
            callId: "call-1",
            name: "Bash",
            status: "running",
            error: null,
            detail: { type: "shell", command: "npm run build" },
          },
          "2026-08-13T10:00:02.000Z",
          2,
        ),
      ],
    });
    expect(activity).toEqual({
      phase: "tool",
      detail: "npm run build",
      startedAt: Date.parse("2026-08-13T10:00:00.000Z"),
    });
  });

  it("ignores a completed tool call at the tail", () => {
    const activity = deriveLiveActivity({
      status: "running",
      entries: [
        entry(
          {
            type: "tool_call",
            callId: "call-1",
            name: "Bash",
            status: "completed",
            error: null,
            detail: { type: "shell", command: "ls" },
          },
          "2026-08-13T10:00:02.000Z",
          1,
        ),
      ],
    });
    expect(activity).toEqual({ phase: "replying" });
  });

  it("uses the most recent user message as the turn start", () => {
    const activity = deriveLiveActivity({
      status: "running",
      entries: [
        entry({ type: "user_message", text: "first" }, "2026-08-13T10:00:00.000Z", 1),
        entry({ type: "user_message", text: "second" }, "2026-08-13T10:05:00.000Z", 3),
      ],
    });
    expect(activity?.startedAt).toBe(Date.parse("2026-08-13T10:05:00.000Z"));
  });

  it("omits the start when no user message is loaded or the timestamp is unparsable", () => {
    expect(deriveLiveActivity({ status: "running", entries: [] })).toEqual({ phase: "replying" });
    expect(
      deriveLiveActivity({
        status: "running",
        entries: [entry({ type: "user_message", text: "hi" }, "not-a-date", 1)],
      }),
    ).toEqual({ phase: "replying" });
  });
});
