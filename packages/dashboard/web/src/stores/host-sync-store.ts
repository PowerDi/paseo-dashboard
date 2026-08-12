import { create } from "zustand";
import type { Host, SyncChange } from "@getpaseo/dashboard-shared";
import { syncHosts as apiSyncHosts } from "../api/dashboardApi";

/**
 * Host sync state machine.
 *
 * The browser persists `lastRevision` in localStorage. On each `sync()` call,
 * it polls `/api/v1/host-sync?after=lastRevision` and applies the returned
 * changes to the local host registry. Pagination follows `hasMore` until the
 * client catches up to `toRevision`.
 *
 * Repeated application is idempotent: an upsert overwrites the same host data,
 * a delete on an already-absent host is a no-op.
 *
 * `forceResync()` resets the cursor to 0 and refetches all hosts — used when
 * the local state is suspected corrupt or after a long offline period.
 */

const LAST_REVISION_KEY = "paseo-dashboard:last-revision";
const SYNC_PAGE_LIMIT = 100;

export type SyncStatus = "idle" | "syncing" | "error";

export interface HostSyncState {
  hosts: Map<string, Host>;
  lastRevision: number;
  syncStatus: SyncStatus;
  syncError: string | null;

  init: () => void;
  sync: () => Promise<void>;
  forceResync: () => Promise<void>;
  applyChange: (change: SyncChange) => void;
  clear: () => void;
}

function loadLastRevision(): number {
  try {
    const stored = globalThis.localStorage?.getItem(LAST_REVISION_KEY);
    return stored ? Number.parseInt(stored, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function saveLastRevision(revision: number): void {
  try {
    globalThis.localStorage?.setItem(LAST_REVISION_KEY, String(revision));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

function clearLastRevision(): void {
  try {
    globalThis.localStorage?.removeItem(LAST_REVISION_KEY);
  } catch {
    // ignore
  }
}

export const useHostSyncStore = create<HostSyncState>((set, get) => ({
  hosts: new Map(),
  lastRevision: 0,
  syncStatus: "idle",
  syncError: null,

  init: () => {
    set({ lastRevision: loadLastRevision() });
  },

  sync: async () => {
    // Prevent concurrent sync runs — a second call while already syncing
    // is a no-op.
    if (get().syncStatus === "syncing") return;
    set({ syncStatus: "syncing", syncError: null });
    try {
      let after = get().lastRevision;
      for (;;) {
        const res = await apiSyncHosts(after, SYNC_PAGE_LIMIT);
        for (const change of res.changes) {
          get().applyChange(change);
        }
        if (res.changes.length > 0) {
          after = res.changes[res.changes.length - 1].revision;
        }
        if (!res.hasMore) {
          after = res.toRevision;
          break;
        }
        // Persist intermediate progress so a crash doesn't re-fetch the
        // entire batch.
        saveLastRevision(after);
        set({ lastRevision: after });
      }
      saveLastRevision(after);
      set({ lastRevision: after, syncStatus: "idle" });
    } catch (error) {
      set({
        syncStatus: "error",
        syncError: error instanceof Error ? error.message : "同步失败",
      });
    }
  },

  forceResync: async () => {
    saveLastRevision(0);
    set({ lastRevision: 0, hosts: new Map() });
    await get().sync();
  },

  applyChange: (change) => {
    set((state) => {
      const hosts = new Map(state.hosts);
      if (change.operation === "upsert") {
        hosts.set(change.host.id, change.host);
      } else {
        hosts.delete(change.hostId);
      }
      return { hosts };
    });
  },

  clear: () => {
    clearLastRevision();
    set({ hosts: new Map(), lastRevision: 0, syncStatus: "idle", syncError: null });
  },
}));
