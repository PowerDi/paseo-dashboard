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

type EventListener = (event: ConfigEvent, eventId: number) => void;

interface Subscription {
  listener: EventListener;
  afterEventId: number;
}

export interface ConfigEventSubscribeOptions {
  /**
   * Suppress events already observed by a reconnecting SSE client.
   * The bus is intentionally not a durable replay store; clients use the
   * revision in the notification to catch up through the sync API.
   */
  afterEventId?: number;
}

export class ConfigEventBus {
  private listeners = new Map<string, Set<Subscription>>();
  private nextEventIds = new Map<string, number>();

  subscribe(
    userId: string,
    listener: EventListener,
    options: ConfigEventSubscribeOptions = {},
  ): () => void {
    let set = this.listeners.get(userId);
    if (!set) {
      set = new Set();
      this.listeners.set(userId, set);
    }

    const subscription: Subscription = {
      listener,
      afterEventId: Number.isSafeInteger(options.afterEventId)
        ? Math.max(options.afterEventId!, 0)
        : 0,
    };
    set.add(subscription);

    let active = true;
    return () => {
      if (!active) return;
      active = false;

      const current = this.listeners.get(userId);
      if (!current) return;
      current.delete(subscription);
      if (current.size === 0) {
        this.listeners.delete(userId);
      }
    };
  }

  emit(userId: string, event: ConfigEvent): void {
    const eventId = (this.nextEventIds.get(userId) ?? 0) + 1;
    this.nextEventIds.set(userId, eventId);

    const set = this.listeners.get(userId);
    if (!set) return;

    // Snapshot the subscriptions so listeners added while dispatching wait
    // for the next event, while listeners removed during dispatch are skipped.
    const subscriptions: Subscription[] = [];
    for (const subscription of set) subscriptions.push(subscription);
    for (const subscription of subscriptions) {
      if (!set.has(subscription) || eventId <= subscription.afterEventId) continue;
      try {
        subscription.listener(event, eventId);
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
