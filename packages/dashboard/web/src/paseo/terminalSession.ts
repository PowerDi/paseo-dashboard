import type { TerminalState } from "@getpaseo/protocol/messages";
import type { DaemonClientLike } from "./connectionManager";
import { getDaemonFeatures } from "./features";

export const TERMINAL_RESTORE_SCROLLBACK_LINES = 200;

export type TerminalSessionClient = Pick<
  DaemonClientLike,
  | "subscribeTerminal"
  | "unsubscribeTerminal"
  | "sendTerminalInput"
  | "onTerminalStreamEvent"
  | "on"
  | "getLastServerInfoMessage"
>;

export interface TerminalSize {
  rows: number;
  cols: number;
}

export type TerminalSessionStatus =
  | { phase: "attaching" }
  | { phase: "attached" }
  | { phase: "exited" }
  | { phase: "error"; message: string };

export interface TerminalSessionSink {
  /** Raw pty bytes (output and restore replays); write straight into xterm. */
  onOutput(data: Uint8Array): void;
  /** Full cell-grid snapshot; reset the emulator and repaint from it. */
  onSnapshot(state: TerminalState): void;
  onStatus(status: TerminalSessionStatus): void;
}

export interface TerminalSessionOptions {
  client: TerminalSessionClient;
  terminalId: string;
  sink: TerminalSessionSink;
  /** Size to claim at attach; the daemon resizes the pty to it. */
  size: TerminalSize | null;
}

export interface TerminalSession {
  sendInput(data: string): void;
  resize(size: TerminalSize): void;
  dispose(): void;
}

/**
 * Attaches to one daemon terminal: subscribes the binary stream, forwards
 * output/snapshot frames into the sink, and owns the resize intent protocol
 * (claim at attach, update afterwards — see docs/terminal-performance.md,
 * "Terminal size has one daemon-owned claimant").
 */
export function openTerminalSession(options: TerminalSessionOptions): TerminalSession {
  const { client, terminalId, sink } = options;
  let disposed = false;
  let attached = false;

  const unsubscribeStream = client.onTerminalStreamEvent((event) => {
    if (disposed || event.terminalId !== terminalId) return;
    if (event.type === "snapshot") {
      sink.onSnapshot(event.state);
      return;
    }
    if (event.data.length > 0) sink.onOutput(event.data);
  });

  const unsubscribeExit = client.on("terminal_stream_exit", (message) => {
    if (disposed || message.payload.terminalId !== terminalId) return;
    sink.onStatus({ phase: "exited" });
  });

  sink.onStatus({ phase: "attaching" });

  // COMPAT(terminalRestoreModes): added in v0.1.81, remove gate after 2026-11-23.
  // Old daemons ignore restore options and send a snapshot frame instead.
  const serverInfo = client.getLastServerInfoMessage();
  const features = getDaemonFeatures(serverInfo);
  const supportsRestoreModes = features.terminalRestoreModes;
  const restore = supportsRestoreModes
    ? {
        mode: "visible-snapshot" as const,
        scrollbackLines: TERMINAL_RESTORE_SCROLLBACK_LINES,
        ...(options.size ? { size: options.size } : {}),
      }
    : undefined;

  void client
    .subscribeTerminal(terminalId, restore ? { restore } : undefined)
    .then((payload) => {
      if (disposed) return;
      if ("error" in payload && typeof payload.error === "string") {
        sink.onStatus({ phase: "error", message: payload.error });
        return;
      }
      // The restore size already claimed the pty; only claim explicitly when
      // it could not be sent with the subscription.
      if (!restore?.size && options.size) {
        client.sendTerminalInput(terminalId, {
          type: "resize",
          rows: options.size.rows,
          cols: options.size.cols,
          intent: "claim",
        });
      }
      attached = true;
      sink.onStatus({ phase: "attached" });
    })
    .catch((error: unknown) => {
      if (disposed) return;
      sink.onStatus({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });

  return {
    sendInput(data) {
      if (disposed || !attached) return;
      client.sendTerminalInput(terminalId, { type: "input", data });
    },
    resize(size) {
      if (disposed || !attached) return;
      client.sendTerminalInput(terminalId, {
        type: "resize",
        rows: size.rows,
        cols: size.cols,
        intent: "update",
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeStream();
      unsubscribeExit();
      client.unsubscribeTerminal(terminalId);
    },
  };
}
