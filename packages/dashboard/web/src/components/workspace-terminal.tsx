import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TerminalView } from "@/components/terminal-view";
import { cn } from "@/lib/utils";
import { dashboardRuntime, type DashboardTerminalInfo } from "@/paseo/dashboardRuntime";
import type { TerminalSessionSink, TerminalSize } from "@/paseo/terminalSession";

interface WorkspaceTerminalProps {
  hostId: string;
  cwd: string;
  workspaceId?: string;
}

export function WorkspaceTerminal({ hostId, cwd, workspaceId }: WorkspaceTerminalProps) {
  const { t } = useTranslation();
  const [terminals, setTerminals] = useState<DashboardTerminalInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const list = await dashboardRuntime.listTerminals(hostId, cwd, workspaceId);
    setTerminals(list);
    return list;
  }, [hostId, cwd, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setActiveId(null);
    setTerminals([]);
    refresh()
      .then((list) => {
        if (cancelled) return;
        setActiveId(list[0]?.id ?? null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const handleCreate = () =>
    runAction(async () => {
      const terminal = await dashboardRuntime.createTerminal(hostId, cwd, { workspaceId });
      await refresh().catch(() => undefined);
      setActiveId(terminal.id);
    });

  const handleKill = (terminalId: string) =>
    runAction(async () => {
      await dashboardRuntime.killTerminal(hostId, terminalId);
      const list = await refresh();
      setActiveId((current) => (current === terminalId ? (list[0]?.id ?? null) : current));
    });

  const openSession = useCallback(
    (sink: TerminalSessionSink, size: TerminalSize | null) => {
      if (!activeId) throw new Error("No active terminal");
      return dashboardRuntime.openTerminal(hostId, activeId, sink, size);
    },
    [hostId, activeId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={cn(
              "group flex items-center rounded-[var(--radius-md)] border text-[13px]",
              terminal.id === activeId
                ? "border-[var(--border-subtle)] bg-[var(--surface-muted)] text-[var(--foreground)]"
                : "border-transparent text-[var(--foreground-subtle)] hover:bg-[var(--surface-hover)]",
            )}
          >
            <button
              type="button"
              className="max-w-48 truncate py-1 pl-2.5 pr-1.5"
              onClick={() => setActiveId(terminal.id)}
            >
              {terminal.title ?? terminal.name}
            </button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="mr-0.5 size-5 opacity-0 hover:text-[var(--danger)] group-hover:opacity-100"
              title={t("workspace.terminal.kill")}
              disabled={busy}
              onClick={() => void handleKill(terminal.id)}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        ))}
        <Button
          size="icon-sm"
          variant="ghost"
          title={t("workspace.terminal.create")}
          disabled={busy || loading}
          onClick={() => void handleCreate()}
        >
          <Plus size={14} />
        </Button>
      </div>

      {error && (
        <p className="shrink-0 text-[13px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {activeId ? (
          <TerminalView key={`${hostId}:${activeId}`} openSession={openSession} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] text-[13px] text-[var(--foreground-subtle)]">
            {loading ? t("workspace.terminal.loading") : t("workspace.terminal.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
