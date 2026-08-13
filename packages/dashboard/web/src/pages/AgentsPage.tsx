import type { Host } from "@getpaseo/dashboard-shared";
import { Archive, Bot, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import {
  buildAgentRows,
  sessionStatus,
  type AgentListRow,
  type SessionStatus,
} from "@/lib/agent-tree";
import { formatRelativeTime } from "@/lib/format-time";
import type { DashboardHostRuntimeState } from "@/paseo/dashboardRuntime";
import { revealDelay, useReveal } from "@/lib/use-reveal";
import { cn } from "@/lib/utils";

interface AgentsPageProps {
  hosts: readonly Host[];
  runtimes: ReadonlyMap<string, DashboardHostRuntimeState>;
  selectedAgentId: string | null;
  onSelectAgent: (hostId: string, agentId: string) => void;
  onCancelAgent: (hostId: string, agentId: string) => Promise<void>;
  onArchiveAgent: (hostId: string, agentId: string) => Promise<void>;
}

const statusTokens: Record<SessionStatus, { color: string; className: string }> = {
  running: { color: "var(--running)", className: "text-[var(--running)]" },
  idle: { color: "#747474", className: "text-[var(--foreground-subtle)]" },
  error: { color: "var(--danger)", className: "text-[var(--danger)]" },
};

function AgentRow({
  row,
  selected,
  onSelect,
  onCancel,
  onArchive,
}: {
  row: AgentListRow;
  selected: boolean;
  onSelect: () => void;
  onCancel: () => Promise<void>;
  onArchive: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState<"cancel" | "archive" | null>(null);
  const agent = row.entry.agent;
  const status = sessionStatus(agent.status);
  const tokens = statusTokens[status];

  function runAction(kind: "cancel" | "archive", action: () => Promise<void>) {
    return async (event: React.MouseEvent) => {
      event.stopPropagation();
      setPending(kind);
      try {
        await action();
      } catch (error) {
        window.alert(
          t("agents.actionFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        setPending(null);
      }
    };
  }

  return (
    <div
      className={cn(
        "dashboard-list-row group w-full cursor-pointer text-left",
        selected && "is-selected",
      )}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect();
      }}
    >
      <span className="dashboard-status-dot" style={{ background: tokens.color }} />
      <Bot size={15} className="shrink-0 text-[var(--foreground-subtle)]" />
      <div className="dashboard-row-copy">
        <div className="flex min-w-0 items-center gap-2">
          <span className="dashboard-row-title">{agent.title ?? t("workspace.untitledAgent")}</span>
          <span className="text-[13px] text-[var(--foreground-subtle)]">{agent.provider}</span>
        </div>
        <div className="dashboard-row-description">
          {row.hostLabel} · <span className="font-mono">{agent.cwd}</span>
        </div>
      </div>
      <span className={`hidden shrink-0 text-[13px] sm:inline ${tokens.className}`}>
        {t(`agents.status.${status}`)}
      </span>
      <span className="dashboard-meta shrink-0">
        {formatRelativeTime(agent.updatedAt, i18n.language)}
      </span>
      <div className="ml-1 hidden items-center gap-1 group-hover:flex">
        {status === "running" && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="hover:text-[var(--warning)]"
            title={t("agents.stop")}
            disabled={pending !== null}
            onClick={runAction("cancel", onCancel)}
          >
            <Square size={13} />
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          className="hover:text-[var(--danger)]"
          title={t("agents.archive")}
          disabled={pending !== null}
          onClick={runAction("archive", onArchive)}
        >
          <Archive size={14} />
        </Button>
      </div>
    </div>
  );
}

interface AgentGroup {
  key: "today" | "yesterday" | "earlier";
  rows: AgentListRow[];
}

function groupRows(rows: AgentListRow[], now = new Date()): AgentGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;

  const groups: AgentGroup[] = [
    { key: "today", rows: [] },
    { key: "yesterday", rows: [] },
    { key: "earlier", rows: [] },
  ];
  for (const row of rows) {
    const timestamp = Date.parse(row.entry.agent.updatedAt || row.entry.agent.createdAt);
    if (timestamp >= startOfToday) groups[0].rows.push(row);
    else if (timestamp >= startOfYesterday) groups[1].rows.push(row);
    else groups[2].rows.push(row);
  }
  return groups.filter((group) => group.rows.length > 0);
}

export function AgentsPage({
  hosts,
  runtimes,
  selectedAgentId,
  onSelectAgent,
  onCancelAgent,
  onArchiveAgent,
}: AgentsPageProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => buildAgentRows(hosts, runtimes), [hosts, runtimes]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const running = rows.filter((row) => sessionStatus(row.entry.agent.status) === "running").length;
  useReveal([rows.length]);

  return (
    <>
      <header className="dashboard-screen-header">
        <h1 className="dashboard-screen-title">{t("agents.title")}</h1>
        <span className="dashboard-screen-subtitle">
          {t("agents.subtitle", { count: rows.length, running })}
        </span>
      </header>
      <div className="dashboard-screen-body">
        <div className="dashboard-page-column">
          {rows.length === 0 && (
            <p
              className="py-6 text-center text-[13px] text-[var(--foreground-faint)]"
              data-reveal=""
              style={revealDelay(0)}
            >
              {t("agents.empty")}
            </p>
          )}
          {groups.map((group, index) => (
            <div key={group.key} className={index > 0 ? "mt-8" : undefined}>
              <SectionLabel style={revealDelay(index * 2)}>{t(`agents.${group.key}`)}</SectionLabel>
              <div data-reveal="" style={revealDelay(index * 2 + 1)}>
                {group.rows.map((row) => (
                  <AgentRow
                    key={`${row.hostId}-${row.entry.agent.id}`}
                    row={row}
                    selected={row.entry.agent.id === selectedAgentId}
                    onSelect={() => onSelectAgent(row.hostId, row.entry.agent.id)}
                    onCancel={() => onCancelAgent(row.hostId, row.entry.agent.id)}
                    onArchive={() => onArchiveAgent(row.hostId, row.entry.agent.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
