import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createTimelineStore,
  timelineKey,
  type TimelineDataClient,
  type TimelineEntry,
  type TimelinePage,
} from "./timeline-store";

function entry(seqStart: number, seqEnd: number, text = `msg ${seqStart}`): TimelineEntry {
  return {
    provider: "codex",
    item: { type: "assistant_message", text },
    timestamp: "2026-08-13T00:00:00.000Z",
    seqStart,
    seqEnd,
    sourceSeqRanges: [{ startSeq: seqStart, endSeq: seqEnd }],
    collapsed: [],
  };
}

function page(overrides: Partial<TimelinePage> = {}): TimelinePage {
  const entries = overrides.entries ?? [];
  const maxSeq = entries.length > 0 ? entries[entries.length - 1].seqEnd : 0;
  return {
    requestId: "req",
    agentId: "agent-1",
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq, nextSeq: maxSeq + 1 },
    startCursor: entries.length > 0 ? { seq: entries[0].seqStart, epoch: "epoch-1" } : null,
    endCursor: entries.length > 0 ? { seq: maxSeq, epoch: "epoch-1" } : null,
    hasOlder: false,
    hasNewer: false,
    entries,
    error: null,
    ...overrides,
  };
}

function createClient(
  fetchAgentTimeline: TimelineDataClient["fetchAgentTimeline"],
): TimelineDataClient {
  return { fetchAgentTimeline };
}

const KEY = timelineKey("host-a", "agent-1");

describe("timeline store", () => {
  test("open loads the tail page", async () => {
    const fetchAgentTimeline = vi.fn(async () =>
      page({ entries: [entry(0, 2), entry(3, 5)], hasOlder: true }),
    );
    const store = createTimelineStore({
      getClient: () => createClient(fetchAgentTimeline),
      now: () => 100,
    });

    await store.getState().open("host-a", "agent-1");

    expect(fetchAgentTimeline).toHaveBeenCalledWith("agent-1", { direction: "tail", limit: 50 });
    const state = store.getState().byKey.get(KEY);
    expect(state).toMatchObject({
      loading: false,
      error: null,
      epoch: "epoch-1",
      hasOlder: true,
      maxSeq: 5,
      lastUpdated: 100,
    });
    expect(state?.entries.map((e) => e.seqStart)).toEqual([0, 3]);
  });

  test("tail refresh with overlap keeps older history and replaces the overlapped suffix", async () => {
    const fetchAgentTimeline = vi
      .fn<TimelineDataClient["fetchAgentTimeline"]>()
      .mockResolvedValueOnce(
        page({
          entries: [entry(0, 2), entry(3, 5, "Hello")],
          hasOlder: true,
          startCursor: { seq: 0, epoch: "epoch-1" },
        }),
      )
      .mockResolvedValueOnce(
        page({
          entries: [entry(3, 8, "Hello world"), entry(9, 10)],
          hasOlder: true,
          startCursor: { seq: 3, epoch: "epoch-1" },
        }),
      );
    const store = createTimelineStore({ getClient: () => createClient(fetchAgentTimeline) });

    await store.getState().open("host-a", "agent-1");
    await store.getState().open("host-a", "agent-1");

    const state = store.getState().byKey.get(KEY);
    expect(state?.entries.map((e) => [e.seqStart, e.seqEnd])).toEqual([
      [0, 2],
      [3, 8],
      [9, 10],
    ]);
    expect(state?.entries[1].item).toEqual({ type: "assistant_message", text: "Hello world" });
    expect(state?.maxSeq).toBe(10);
    // History anchor from the first page is preserved.
    expect(state?.startCursor).toEqual({ seq: 0, epoch: "epoch-1" });
  });

  test("tail refresh replaces everything on epoch change or gap", async () => {
    const fetchAgentTimeline = vi
      .fn<TimelineDataClient["fetchAgentTimeline"]>()
      .mockResolvedValueOnce(page({ entries: [entry(0, 5)] }))
      .mockResolvedValueOnce(page({ entries: [entry(2, 4)], epoch: "epoch-2", hasOlder: true }));
    const store = createTimelineStore({ getClient: () => createClient(fetchAgentTimeline) });

    await store.getState().open("host-a", "agent-1");
    await store.getState().open("host-a", "agent-1");

    const state = store.getState().byKey.get(KEY);
    expect(state?.epoch).toBe("epoch-2");
    expect(state?.entries.map((e) => e.seqStart)).toEqual([2]);
    expect(state?.hasOlder).toBe(true);
  });

  test("tail refresh with a sequence gap replaces the loaded range", async () => {
    const fetchAgentTimeline = vi
      .fn<TimelineDataClient["fetchAgentTimeline"]>()
      .mockResolvedValueOnce(page({ entries: [entry(0, 2)] }))
      .mockResolvedValueOnce(page({ entries: [entry(10, 12)], hasOlder: true }));
    const store = createTimelineStore({ getClient: () => createClient(fetchAgentTimeline) });

    await store.getState().open("host-a", "agent-1");
    await store.getState().open("host-a", "agent-1");

    const state = store.getState().byKey.get(KEY);
    expect(state?.entries.map((e) => e.seqStart)).toEqual([10]);
    expect(state?.hasOlder).toBe(true);
  });

  test("loadOlder prepends the previous page", async () => {
    const fetchAgentTimeline = vi
      .fn<TimelineDataClient["fetchAgentTimeline"]>()
      .mockResolvedValueOnce(
        page({
          entries: [entry(5, 9)],
          hasOlder: true,
          startCursor: { seq: 5, epoch: "epoch-1" },
        }),
      )
      .mockResolvedValueOnce(
        page({
          direction: "before",
          entries: [entry(0, 4)],
          hasOlder: false,
          startCursor: { seq: 0, epoch: "epoch-1" },
        }),
      );
    const store = createTimelineStore({ getClient: () => createClient(fetchAgentTimeline) });

    await store.getState().open("host-a", "agent-1");
    await store.getState().loadOlder("host-a", "agent-1");

    expect(fetchAgentTimeline).toHaveBeenLastCalledWith("agent-1", {
      direction: "before",
      cursor: { seq: 5, epoch: "epoch-1" },
      limit: 50,
    });
    const state = store.getState().byKey.get(KEY);
    expect(state?.entries.map((e) => e.seqStart)).toEqual([0, 5]);
    expect(state?.hasOlder).toBe(false);
    expect(state?.startCursor).toEqual({ seq: 0, epoch: "epoch-1" });
  });

  test("loadOlder falls back to a fresh tail on stale cursor", async () => {
    const fetchAgentTimeline = vi
      .fn<TimelineDataClient["fetchAgentTimeline"]>()
      .mockResolvedValueOnce(page({ entries: [entry(5, 9)], hasOlder: true }))
      .mockResolvedValueOnce(page({ direction: "before", staleCursor: true, entries: [] }))
      .mockResolvedValueOnce(page({ entries: [entry(20, 22)] }));
    const store = createTimelineStore({ getClient: () => createClient(fetchAgentTimeline) });

    await store.getState().open("host-a", "agent-1");
    await store.getState().loadOlder("host-a", "agent-1");

    expect(fetchAgentTimeline).toHaveBeenCalledTimes(3);
    const state = store.getState().byKey.get(KEY);
    expect(state?.entries.map((e) => e.seqStart)).toEqual([20]);
  });

  test("open surfaces fetch errors and can retry", async () => {
    const fetchAgentTimeline = vi
      .fn<TimelineDataClient["fetchAgentTimeline"]>()
      .mockRejectedValueOnce(new Error("daemon offline"))
      .mockResolvedValueOnce(page({ entries: [entry(0, 1)] }));
    const store = createTimelineStore({ getClient: () => createClient(fetchAgentTimeline) });

    await store.getState().open("host-a", "agent-1");
    expect(store.getState().byKey.get(KEY)?.error).toBe("daemon offline");

    await store.getState().open("host-a", "agent-1");
    expect(store.getState().byKey.get(KEY)?.error).toBeNull();
    expect(store.getState().byKey.get(KEY)?.entries).toHaveLength(1);
  });

  test("close drops state and ignores in-flight results", async () => {
    let resolvePage: (value: TimelinePage) => void = () => undefined;
    const fetchAgentTimeline = vi.fn(
      () => new Promise<TimelinePage>((resolve) => (resolvePage = resolve)),
    );
    const store = createTimelineStore({ getClient: () => createClient(fetchAgentTimeline) });

    const opening = store.getState().open("host-a", "agent-1");
    store.getState().close("host-a", "agent-1");
    resolvePage(page({ entries: [entry(0, 1)] }));
    await opening;

    expect(store.getState().byKey.has(KEY)).toBe(false);
  });

  describe("stream events", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("throttles a tail refresh for open agents", async () => {
      const fetchAgentTimeline = vi
        .fn<TimelineDataClient["fetchAgentTimeline"]>()
        .mockResolvedValue(page({ entries: [entry(0, 1)] }));
      const store = createTimelineStore({
        getClient: () => createClient(fetchAgentTimeline),
        throttleMs: 400,
      });
      await store.getState().open("host-a", "agent-1");
      expect(fetchAgentTimeline).toHaveBeenCalledTimes(1);

      for (let index = 0; index < 3; index += 1) {
        store.getState().notifyStreamEvent("host-a", {
          agentId: "agent-1",
          event: { type: "turn_completed", provider: "codex" },
          timestamp: "2026-08-13T00:00:00.000Z",
        });
      }
      await vi.advanceTimersByTimeAsync(400);

      expect(fetchAgentTimeline).toHaveBeenCalledTimes(2);
    });

    test("ignores events for unopened agents and already-covered sequences", async () => {
      const fetchAgentTimeline = vi
        .fn<TimelineDataClient["fetchAgentTimeline"]>()
        .mockResolvedValue(page({ entries: [entry(0, 5)] }));
      const store = createTimelineStore({
        getClient: () => createClient(fetchAgentTimeline),
        throttleMs: 400,
      });
      await store.getState().open("host-a", "agent-1");

      store.getState().notifyStreamEvent("host-a", {
        agentId: "agent-other",
        event: { type: "turn_completed", provider: "codex" },
        timestamp: "2026-08-13T00:00:00.000Z",
      });
      store.getState().notifyStreamEvent("host-a", {
        agentId: "agent-1",
        event: {
          type: "timeline",
          provider: "codex",
          item: { type: "assistant_message", text: "old" },
        },
        timestamp: "2026-08-13T00:00:00.000Z",
        seq: 3,
        epoch: "epoch-1",
      });
      await vi.advanceTimersByTimeAsync(1000);

      expect(fetchAgentTimeline).toHaveBeenCalledTimes(1);
    });
  });
});
