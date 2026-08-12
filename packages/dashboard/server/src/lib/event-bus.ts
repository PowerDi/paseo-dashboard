/**
 * In-memory config event bus, keyed by userId.
 *
 * Only carries Dashboard configuration notifications — never daemon data,
 * agent output, timeline, or terminal frames. Clients receive these events
 * and then poll the sync API to fetch the actual changes.
 */

export interface ConfigEvent {
  type: "host.upserted" | "host.deleted" | "device.revoked" | "session.revoked";
  revision: number;
  timestamp: string;
  data: Record<string, unknown>;
}

type EventListener = (event: ConfigEvent) => void;

export class ConfigEventBus {
  private listeners = new Map<string, Set<EventListener>>();

  subscribe(userId: string, listener: EventListener): () => void {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }
    set.add(listener);
    return () => {
      const s = this.listeners.get(userId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) {
        this.listeners.delete(userId);
      }
    };
  }

  emit(userId: string, event: ConfigEvent): void {
    const set = this.listeners.get(userId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // Listener errors must not break other listeners or the emit caller.
      }
    }
  }

  /** Test helper: returns the number of active listeners for a user. */
  listenerCount(userId: string): number {
    return this.listeners.get(userId)?.size ?? 0;
  }
}
