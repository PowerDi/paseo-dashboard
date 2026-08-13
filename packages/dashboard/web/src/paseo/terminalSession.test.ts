import type { TerminalStreamEvent } from "@getpaseo/client/internal/daemon-client";
import type {
  ServerInfoStatusPayload,
  SessionOutboundMessage,
  TerminalState,
} from "@getpaseo/protocol/messages";
import { describe, expect, test, vi } from "vitest";
import {
  openTerminalSession,
  TERMINAL_RESTORE_SCROLLBACK_LINES,
  type TerminalSessionClient,
  type TerminalSessionSink,
  type TerminalSessionStatus,
} from "./terminalSession";

function terminalState(): TerminalState {
  return {
    rows: 24,
    cols: 80,
    grid: [],
    scrollback: [],
    cursor: { row: 0, col: 0 },
  };
}

class FakeTerminalClient implements TerminalSessionClient {
  private readonly streamListeners = new Set<(event: TerminalStreamEvent) => void>();
  private readonly exitListeners = new Set<(message: SessionOutboundMessage) => void>();
  supportsRestoreModes = true;
  subscribeError: string | null = null;
  subscribeRejection: Error | null = null;
  pendingSubscribes: Array<() => void> = [];

  readonly subscribeTerminal = vi.fn(
    async (terminalId: string, _options?: { restore?: unknown }) => {
      if (this.subscribeRejection) throw this.subscribeRejection;
      await new Promise<void>((resolve) => {
        this.pendingSubscribes.push(resolve);
        queueMicrotask(() => {
          const next = this.pendingSubscribes.shift();
          next?.();
        });
      });
      if (this.subscribeError) {
        return { terminalId, error: this.subscribeError, requestId: "req-1" };
      }
      return { terminalId, slot: 1, error: null, requestId: "req-1" };
    },
  ) as unknown as TerminalSessionClient["subscribeTerminal"];

  readonly unsubscribeTerminal = vi.fn((_terminalId: string) => undefined);
  readonly sendTerminalInput = vi.fn(
    (_terminalId: string, _message: unknown) => undefined,
  ) as unknown as TerminalSessionClient["sendTerminalInput"];

  onTerminalStreamEvent(handler: (event: TerminalStreamEvent) => void): () => void {
    this.streamListeners.add(handler);
    return () => this.streamListeners.delete(handler);
  }

  // Property with an assertion because matching DaemonClient's `on` overload
  // set is not worth it in a fake.
  readonly on = ((
    type: SessionOutboundMessage["type"] | ((message: SessionOutboundMessage) => void),
    handler?: (message: SessionOutboundMessage) => void,
  ) => {
    if (typeof type === "function" || !handler || type !== "terminal_stream_exit") {
      return () => undefined;
    }
    this.exitListeners.add(handler);
    return () => this.exitListeners.delete(handler);
  }) as TerminalSessionClient["on"];

  getLastServerInfoMessage(): ServerInfoStatusPayload | null {
    return {
      status: "server_info",
      serverId: "server-1",
      features: { "terminal-restore-modes": this.supportsRestoreModes },
    } as ServerInfoStatusPayload;
  }

  emitStream(event: TerminalStreamEvent): void {
    for (const listener of this.streamListeners) listener(event);
  }

  emitExit(terminalId: string): void {
    const message = {
      type: "terminal_stream_exit",
      payload: { terminalId },
    } as SessionOutboundMessage;
    for (const listener of this.exitListeners) listener(message);
  }

  streamListenerCount(): number {
    return this.streamListeners.size;
  }
}

function collectingSink() {
  const outputs: Uint8Array[] = [];
  const snapshots: TerminalState[] = [];
  const statuses: TerminalSessionStatus[] = [];
  const sink: TerminalSessionSink = {
    onOutput: (data) => outputs.push(data),
    onSnapshot: (state) => snapshots.push(state),
    onStatus: (status) => statuses.push(status),
  };
  return { sink, outputs, snapshots, statuses };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("openTerminalSession", () => {
  test("subscribes with visible-snapshot restore and claims via restore size", async () => {
    const client = new FakeTerminalClient();
    const { sink, statuses } = collectingSink();

    openTerminalSession({
      client,
      terminalId: "term-1",
      sink,
      size: { rows: 30, cols: 100 },
    });
    await flushMicrotasks();

    expect(client.subscribeTerminal).toHaveBeenCalledWith("term-1", {
      restore: {
        mode: "visible-snapshot",
        scrollbackLines: TERMINAL_RESTORE_SCROLLBACK_LINES,
        size: { rows: 30, cols: 100 },
      },
    });
    // The restore size already claimed the pty.
    expect(client.sendTerminalInput).not.toHaveBeenCalled();
    expect(statuses.map((status) => status.phase)).toEqual(["attaching", "attached"]);
  });

  test("claims size explicitly when the daemon lacks restore modes", async () => {
    const client = new FakeTerminalClient();
    client.supportsRestoreModes = false;
    const { sink } = collectingSink();

    openTerminalSession({
      client,
      terminalId: "term-1",
      sink,
      size: { rows: 24, cols: 80 },
    });
    await flushMicrotasks();

    expect(client.subscribeTerminal).toHaveBeenCalledWith("term-1", undefined);
    expect(client.sendTerminalInput).toHaveBeenCalledWith("term-1", {
      type: "resize",
      rows: 24,
      cols: 80,
      intent: "claim",
    });
  });

  test("routes output and snapshot frames for its terminal only", async () => {
    const client = new FakeTerminalClient();
    const { sink, outputs, snapshots } = collectingSink();

    openTerminalSession({ client, terminalId: "term-1", sink, size: null });
    await flushMicrotasks();

    client.emitStream({ terminalId: "term-1", type: "output", data: new Uint8Array([104, 105]) });
    client.emitStream({ terminalId: "term-2", type: "output", data: new Uint8Array([110, 111]) });
    client.emitStream({ terminalId: "term-1", type: "output", data: new Uint8Array([]) });
    client.emitStream({ terminalId: "term-1", type: "restore", data: new Uint8Array([114]) });
    client.emitStream({ terminalId: "term-1", type: "snapshot", state: terminalState() });
    client.emitStream({ terminalId: "term-2", type: "snapshot", state: terminalState() });

    expect(outputs).toEqual([new Uint8Array([104, 105]), new Uint8Array([114])]);
    expect(snapshots).toHaveLength(1);
  });

  test("reports subscribe errors and ignores input before attach", async () => {
    const client = new FakeTerminalClient();
    client.subscribeError = "terminal not found";
    const { sink, statuses } = collectingSink();

    const session = openTerminalSession({ client, terminalId: "term-1", sink, size: null });
    session.sendInput("early");
    await flushMicrotasks();
    session.sendInput("late");

    expect(statuses.at(-1)).toEqual({ phase: "error", message: "terminal not found" });
    expect(client.sendTerminalInput).not.toHaveBeenCalled();
  });

  test("reports subscribe rejections", async () => {
    const client = new FakeTerminalClient();
    client.subscribeRejection = new Error("socket closed");
    const { sink, statuses } = collectingSink();

    openTerminalSession({ client, terminalId: "term-1", sink, size: null });
    await flushMicrotasks();

    expect(statuses.at(-1)).toEqual({ phase: "error", message: "socket closed" });
  });

  test("sends input and update resizes after attach", async () => {
    const client = new FakeTerminalClient();
    const { sink } = collectingSink();

    const session = openTerminalSession({ client, terminalId: "term-1", sink, size: null });
    await flushMicrotasks();

    session.sendInput("ls\r");
    session.resize({ rows: 40, cols: 120 });

    expect(client.sendTerminalInput).toHaveBeenNthCalledWith(1, "term-1", {
      type: "input",
      data: "ls\r",
    });
    expect(client.sendTerminalInput).toHaveBeenNthCalledWith(2, "term-1", {
      type: "resize",
      rows: 40,
      cols: 120,
      intent: "update",
    });
  });

  test("surfaces terminal exit for its terminal only", async () => {
    const client = new FakeTerminalClient();
    const { sink, statuses } = collectingSink();

    openTerminalSession({ client, terminalId: "term-1", sink, size: null });
    await flushMicrotasks();

    client.emitExit("term-2");
    expect(statuses.map((status) => status.phase)).not.toContain("exited");
    client.emitExit("term-1");
    expect(statuses.at(-1)).toEqual({ phase: "exited" });
  });

  test("dispose unsubscribes and stops forwarding", async () => {
    const client = new FakeTerminalClient();
    const { sink, outputs } = collectingSink();

    const session = openTerminalSession({ client, terminalId: "term-1", sink, size: null });
    await flushMicrotasks();

    session.dispose();
    session.dispose();

    expect(client.unsubscribeTerminal).toHaveBeenCalledExactlyOnceWith("term-1");
    expect(client.streamListenerCount()).toBe(0);
    client.emitStream({ terminalId: "term-1", type: "output", data: new Uint8Array([104]) });
    expect(outputs).toHaveLength(0);
    session.sendInput("ignored");
    expect(client.sendTerminalInput).not.toHaveBeenCalled();
  });
});
