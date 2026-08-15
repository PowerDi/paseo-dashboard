import { renderTerminalSnapshotToAnsi } from "@getpaseo/protocol/terminal-snapshot";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { THEME_CHANGE_EVENT } from "../stores/theme-store";
import { useTranslation } from "react-i18next";
import type {
  TerminalSession,
  TerminalSessionSink,
  TerminalSessionStatus,
  TerminalSize,
} from "../paseo/terminalSession";
import "@xterm/xterm/css/xterm.css";

export type TerminalSessionOpener = (
  sink: TerminalSessionSink,
  size: TerminalSize | null,
) => TerminalSession;

interface TerminalViewProps {
  /** Remount (key) the component per terminal; it opens one session for its lifetime. */
  openSession: TerminalSessionOpener;
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  return {
    background: color("--surface-soft"),
    foreground: color("--foreground"),
    cursor: color("--foreground"),
    selectionBackground: color("--surface-muted"),
  };
}

export function TerminalView({ openSession }: TerminalViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<TerminalSessionStatus>({ phase: "attaching" });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      convertEol: false,
      scrollback: 5000,
      // xterm measures glyphs through the canvas font API, which does not
      // resolve CSS variables — spell the stack out.
      fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      theme: terminalTheme(),
    });
    const updateTheme = () => (terminal.options.theme = terminalTheme());
    globalThis.addEventListener(THEME_CHANGE_EVENT, updateTheme);
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();

    const initialSize: TerminalSize | null =
      terminal.rows > 0 && terminal.cols > 0 ? { rows: terminal.rows, cols: terminal.cols } : null;

    const sink: TerminalSessionSink = {
      onOutput: (data) => terminal.write(data),
      onSnapshot: (state) => {
        terminal.reset();
        terminal.write(renderTerminalSnapshotToAnsi(state));
      },
      onStatus: (next) => setStatus(next),
    };
    const session = openSession(sink, initialSize);

    const dataDisposable = terminal.onData((data) => session.sendInput(data));

    const resizeObserver = new ResizeObserver(() => {
      const before = { rows: terminal.rows, cols: terminal.cols };
      fit.fit();
      if (terminal.rows !== before.rows || terminal.cols !== before.cols) {
        session.resize({ rows: terminal.rows, cols: terminal.cols });
      }
    });
    resizeObserver.observe(container);

    return () => {
      globalThis.removeEventListener(THEME_CHANGE_EVENT, updateTheme);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      session.dispose();
      terminal.dispose();
    };
  }, [openSession]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-soft)]">
      <div ref={containerRef} className="h-full w-full p-2" />
      {status.phase !== "attached" && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-[var(--surface-soft)]/80 text-[13px] text-[var(--foreground-muted)]"
          role="status"
        >
          {status.phase === "attaching" && t("workspace.terminal.attaching")}
          {status.phase === "exited" && t("workspace.terminal.exited")}
          {status.phase === "error" && t("workspace.terminal.error", { message: status.message })}
        </div>
      )}
    </div>
  );
}
