import type {
  AgentStreamMessage,
  FetchAgentTimelineResponseMessage,
} from "@getpaseo/protocol/messages";
import { createStore, type StoreApi } from "zustand/vanilla";

const TAIL_LIMIT = 50;
const OLDER_LIMIT = 50;
const STREAM_REFRESH_THROTTLE_MS = 400;

export type TimelinePage = FetchAgentTimelineResponseMessage["payload"];
export type TimelineEntry = TimelinePage["entries"][number];
export type TimelineCursor = NonNullable<TimelinePage["startCursor"]>;
export type AgentStreamPayload = AgentStreamMessage["payload"];

export interface TimelineDataClient {
  fetchAgentTimeline(
    agentId: string,
    options?: {
      direction?: TimelinePage["direction"];
      cursor?: TimelineCursor;
      limit?: number;
    },
  ): Promise<TimelinePage>;
}

export interface AgentTimelineState {
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  epoch: string | null;
  entries: TimelineEntry[];
  startCursor: TimelineCursor | null;
  hasOlder: boolean;
  /** Sequence end of the covered canonical range; -1 before the first page. */
  maxSeq: number;
  lastUpdated: number | null;
}

export interface TimelineStoreState {
  byKey: Map<string, AgentTimelineState>;
  /** Creates the slot and fetches the latest tail page. Idempotent refresh when already open. */
  open(hostId: string, agentId: string): Promise<void>;
  loadOlder(hostId: string, agentId: string): Promise<void>;
  /** Throttled tail refresh for stream events of an open agent. */
  notifyStreamEvent(hostId: string, payload: AgentStreamPayload): void;
  close(hostId: string, agentId: string): void;
  clearHost(hostId: string): void;
  clear(): void;
}

export interface TimelineStoreDependencies {
  getClient(hostId: string): TimelineDataClient | null;
  now?: () => number;
  throttleMs?: number;
}

export function timelineKey(hostId: string, agentId: string): string {
  return `${hostId}\u0000${agentId}`;
}

const EMPTY_STATE: AgentTimelineState = {
  loading: false,
  loadingOlder: false,
  error: null,
  epoch: null,
  entries: [],
  startCursor: null,
  hasOlder: false,
  maxSeq: -1,
  lastUpdated: null,
};

/** Stream event types that can change the timeline and warrant a tail refresh. */
const REFRESH_EVENT_TYPES = new Set([
  "timeline",
  "turn_started",
  "turn_completed",
  "turn_failed",
  "turn_canceled",
  "permission_requested",
  "permission_resolved",
]);

export function createTimelineStore(
  dependencies: TimelineStoreDependencies,
): StoreApi<TimelineStoreState> {
  const now = dependencies.now ?? (() => Date.now());
  const throttleMs = dependencies.throttleMs ?? STREAM_REFRESH_THROTTLE_MS;
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const requestGenerations = new Map<string, number>();

  function bumpGeneration(key: string): number {
    const next = (requestGenerations.get(key) ?? 0) + 1;
    requestGenerations.set(key, next);
    return next;
  }

  function cancelRefreshTimer(key: string): void {
    const timer = refreshTimers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    refreshTimers.delete(key);
  }

  return createStore<TimelineStoreState>()((set, get) => {
    function updateKey(
      key: string,
      update: (state: AgentTimelineState) => AgentTimelineState,
    ): void {
      set((state) => {
        const current = state.byKey.get(key);
        if (!current) return state;
        const byKey = new Map(state.byKey);
        byKey.set(key, update(current));
        return { byKey };
      });
    }

    /**
     * Applies a tail page. Same epoch and an overlapping or adjacent page keep
     * the loaded older history and replace only the overlapped suffix (the
     * daemon's projection is authoritative for merged assistant/tool items).
     * An epoch change, reset, or sequence gap replaces everything.
     */
    function applyTailPage(current: AgentTimelineState, page: TimelinePage): AgentTimelineState {
      const base: AgentTimelineState = {
        ...current,
        loading: false,
        error: null,
        lastUpdated: now(),
      };
      const replace: AgentTimelineState = {
        ...base,
        epoch: page.epoch,
        entries: page.entries,
        startCursor: page.startCursor,
        hasOlder: page.hasOlder,
        maxSeq: page.window.maxSeq,
      };
      if (current.entries.length === 0 || current.epoch !== page.epoch || page.reset) {
        return replace;
      }
      const incoming = page.entries;
      if (incoming.length === 0) {
        return { ...base, maxSeq: Math.max(current.maxSeq, page.window.maxSeq) };
      }
      const cut = incoming[0].seqStart;
      if (cut > current.maxSeq + 1) {
        return replace;
      }
      const kept = current.entries.filter((entry) => entry.seqEnd < cut);
      return {
        ...base,
        entries: [...kept, ...incoming],
        maxSeq: page.window.maxSeq,
        startCursor: kept.length > 0 ? current.startCursor : page.startCursor,
        hasOlder: kept.length > 0 ? current.hasOlder : page.hasOlder,
      };
    }

    async function loadTail(hostId: string, agentId: string): Promise<void> {
      const key = timelineKey(hostId, agentId);
      const client = dependencies.getClient(hostId);
      if (!client) return;
      const generation = bumpGeneration(key);

      set((state) => {
        const byKey = new Map(state.byKey);
        const current = byKey.get(key) ?? EMPTY_STATE;
        byKey.set(key, { ...current, loading: current.entries.length === 0, error: null });
        return { byKey };
      });

      try {
        const page = await client.fetchAgentTimeline(agentId, {
          direction: "tail",
          limit: TAIL_LIMIT,
        });
        if (requestGenerations.get(key) !== generation) return;
        updateKey(key, (current) => applyTailPage(current, page));
      } catch (error) {
        if (requestGenerations.get(key) !== generation) return;
        updateKey(key, (current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    return {
      byKey: new Map(),

      async open(hostId, agentId) {
        const key = timelineKey(hostId, agentId);
        if (!get().byKey.has(key)) {
          set((state) => {
            const byKey = new Map(state.byKey);
            byKey.set(key, EMPTY_STATE);
            return { byKey };
          });
        }
        await loadTail(hostId, agentId);
      },

      async loadOlder(hostId, agentId) {
        const key = timelineKey(hostId, agentId);
        const current = get().byKey.get(key);
        if (!current || current.loadingOlder || !current.hasOlder || !current.startCursor) {
          return;
        }
        const client = dependencies.getClient(hostId);
        if (!client) return;
        const generation = requestGenerations.get(key) ?? 0;
        const cursor = current.startCursor;

        updateKey(key, (state) => ({ ...state, loadingOlder: true }));
        try {
          const page = await client.fetchAgentTimeline(agentId, {
            direction: "before",
            cursor,
            limit: OLDER_LIMIT,
          });
          if (requestGenerations.get(key) !== generation) return;
          if (page.staleCursor || page.reset || page.epoch !== current.epoch) {
            // The requested range no longer exists; fall back to a fresh tail.
            updateKey(key, (state) => ({ ...state, loadingOlder: false }));
            await loadTail(hostId, agentId);
            return;
          }
          updateKey(key, (state) => ({
            ...state,
            loadingOlder: false,
            entries: [...page.entries, ...state.entries],
            startCursor: page.startCursor,
            hasOlder: page.hasOlder,
            lastUpdated: now(),
          }));
        } catch (error) {
          if (requestGenerations.get(key) !== generation) return;
          updateKey(key, (state) => ({
            ...state,
            loadingOlder: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      },

      notifyStreamEvent(hostId, payload) {
        const key = timelineKey(hostId, payload.agentId);
        const current = get().byKey.get(key);
        if (!current) return;
        if (!REFRESH_EVENT_TYPES.has(payload.event.type)) return;
        if (
          typeof payload.seq === "number" &&
          payload.epoch !== undefined &&
          payload.epoch === current.epoch &&
          payload.seq <= current.maxSeq
        ) {
          return;
        }
        if (refreshTimers.has(key)) return;
        refreshTimers.set(
          key,
          setTimeout(() => {
            refreshTimers.delete(key);
            if (!get().byKey.has(key)) return;
            void loadTail(hostId, payload.agentId);
          }, throttleMs),
        );
      },

      close(hostId, agentId) {
        const key = timelineKey(hostId, agentId);
        cancelRefreshTimer(key);
        bumpGeneration(key);
        set((state) => {
          if (!state.byKey.has(key)) return state;
          const byKey = new Map(state.byKey);
          byKey.delete(key);
          return { byKey };
        });
      },

      clearHost(hostId) {
        const prefix = `${hostId}\u0000`;
        set((state) => {
          const byKey = new Map(state.byKey);
          for (const key of byKey.keys()) {
            if (!key.startsWith(prefix)) continue;
            cancelRefreshTimer(key);
            bumpGeneration(key);
            byKey.delete(key);
          }
          return { byKey };
        });
      },

      clear() {
        for (const key of get().byKey.keys()) {
          cancelRefreshTimer(key);
          bumpGeneration(key);
        }
        set({ byKey: new Map() });
      },
    };
  });
}
