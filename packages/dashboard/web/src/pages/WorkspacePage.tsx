import {
  Archive,
  ArrowUp,
  Bot,
  Clock,
  Folder,
  GitBranch,
  LoaderCircle,
  ShieldQuestion,
  Square,
  Terminal,
} from "lucide-react";
import type { Host } from "@getpaseo/dashboard-shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NewSessionComposer } from "@/components/new-session-composer";
import { PermissionRequests } from "@/components/permission-requests";
import { TimelineView } from "@/components/timeline";
import { WorkspaceTerminal } from "@/components/workspace-terminal";
import { Button } from "@/components/ui/button";
import { useAgentTimeline } from "@/hooks/use-agent-timeline";
import type { AgentContext } from "@/lib/agent-tree";
import { sessionStatus } from "@/lib/agent-tree";
import { formatDateTime } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import type { DashboardHostRuntimeState } from "@/paseo/dashboardRuntime";
import { dashboardRuntime } from "@/paseo/dashboardRuntime";

interface WorkspacePageProps {
  context: AgentContext | null;
  hosts: readonly Host[];
  runtimes: ReadonlyMap<string, DashboardHostRuntimeState>;
  onSelectAgent: (hostId: string, agentId: string) => void;
  onCancelAgent: (hostId: string, agentId: string) => Promise<void>;
  onArchiveAgent: (hostId: string, agentId: string) => Promise<void>;
}

function statusColor(status: "running" | "idle" | "error"): string {
  if (status === "running") return "var(--success)";
  if (status === "error") return "var(--danger)";
  return "var(--foreground-faint)";
}

function MetaRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[13px]">
      <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-[var(--foreground-subtle)]">
        <span className="translate-y-[1px]">{icon}</span>
        {label}
      </span>
      <span className="min-w-0 break-all text-[var(--foreground-muted)]">{value}</span>
    </div>
  );
}

export function WorkspacePage({
  context,
  hosts,
  runtimes,
  onSelectAgent,
  onCancelAgent,
  onArchiveAgent,
}: WorkspacePageProps) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<"cancel" | "archive" | null>(null);
  const [view, setView] = useState<"timeline" | "terminal">("timeline");
  const agentId = context?.entry.agent.id ?? null;
  const hostId = context?.host.id ?? null;
  const { timeline, loadOlder } = useAgentTimeline(hostId, agentId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSeqRef = useRef<number>(-1);

  // Keep the view pinned to the newest entry unless the user scrolled up.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const maxSeq = timeline?.maxSeq ?? -1;
    if (maxSeq === lastSeqRef.current) return;
    const isFirstPaint = lastSeqRef.current === -1;
    lastSeqRef.current = maxSeq;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (isFirstPaint || distanceFromBottom < 160) {
      container.scrollTop = container.scrollHeight;
    }
  }, [timeline?.maxSeq]);

  useEffect(() => {
    lastSeqRef.current = -1;
    setView("timeline");
    setDraft("");
  }, [agentId]);

  async function sendDraft() {
    if (!hostId || !agentId || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await dashboardRuntime.sendAgentMessage(hostId, agentId, text);
      setDraft("");
    } catch (error) {
      window.alert(
        t("workspace.sendFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setSending(false);
    }
  }

  function runAction(kind: "cancel" | "archive", action: () => Promise<void>) {
    return async () => {
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

  if (!context) {
    return (
      <>
        <div className="workspace-empty animate-rise">
          <span className="workspace-empty-mark" aria-hidden="true">
            P
          </span>
          <p className="workspace-empty-title">{t("workspace.emptyTitle")}</p>
          <p className="workspace-empty-subtitle">{t("workspace.emptySubtitle")}</p>
        </div>
        <NewSessionComposer hosts={hosts} runtimes={runtimes} onCreated={onSelectAgent} />
      </>
    );
  }

  const { agent, project } = { agent: context.entry.agent, project: context.entry.project };
  const status = sessionStatus(agent.status);
  const title = agent.title ?? t("workspace.untitledAgent");
  const pendingPermissions = agent.pendingPermissions.length;

  return (
    <>
      <header className="workspace-header">
        <div className="workspace-header-copy">
          <span className="workspace-header-title">{title}</span>
          <span className="workspace-header-context">
            {context.host.label} · {project.projectName}
          </span>
        </div>
        <div className="workspace-header-spacer" />
        <span
          className={cn("dashboard-status-dot", status === "running" && "status-dot-pulse")}
          aria-label={status}
          style={{ background: statusColor(status) }}
        />
        <span className="workspace-header-context">
          {t(`agents.status.${status}`)} · {agent.provider}
        </span>
        <div
          className="ml-3 flex items-center gap-0.5 rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-0.5"
          role="tablist"
          aria-label={t("workspace.view.timeline")}
        >
          {(["timeline", "terminal"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={view === candidate}
              className={cn(
                "rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1 text-[12px] font-medium",
                view === candidate
                  ? "bg-[var(--surface-muted)] text-[var(--foreground)]"
                  : "text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)]",
              )}
              onClick={() => setView(candidate)}
            >
              {t(`workspace.view.${candidate}`)}
            </button>
          ))}
        </div>
        <div className="ml-2 flex items-center gap-1">
          {status === "running" && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="hover:text-[var(--warning)]"
              title={t("agents.stop")}
              disabled={pending !== null}
              onClick={runAction("cancel", () => onCancelAgent(context.host.id, agent.id))}
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
            onClick={runAction("archive", () => onArchiveAgent(context.host.id, agent.id))}
          >
            <Archive size={14} />
          </Button>
        </div>
      </header>

      {view === "terminal" ? (
        <div className="min-h-0 flex-1 px-8 py-5">
          <WorkspaceTerminal
            key={`${context.host.id}:${agent.cwd}:${agent.workspaceId ?? ""}`}
            hostId={context.host.id}
            cwd={agent.cwd}
            workspaceId={agent.workspaceId}
          />
        </div>
      ) : (
        <div className="workspace-thread-scroll" ref={scrollRef}>
          <section className="workspace-thread" aria-label={t("workspace.messagesAria", { title })}>
            <div className="mb-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4">
              <div className="space-y-2.5">
                <MetaRow
                  icon={<Bot size={13} />}
                  label={t("workspace.meta.provider")}
                  value={agent.model ? `${agent.provider} · ${agent.model}` : agent.provider}
                />
                <MetaRow
                  icon={<Terminal size={13} />}
                  label={t("workspace.meta.directory")}
                  value={agent.cwd}
                />
                {project.checkout.currentBranch && (
                  <MetaRow
                    icon={<GitBranch size={13} />}
                    label={t("workspace.meta.branch")}
                    value={project.checkout.currentBranch}
                  />
                )}
                <MetaRow
                  icon={<Clock size={13} />}
                  label={t("workspace.meta.updated")}
                  value={formatDateTime(agent.updatedAt, i18n.language)}
                />
                {pendingPermissions > 0 && (
                  <MetaRow
                    icon={<ShieldQuestion size={13} />}
                    label={t("workspace.meta.permissions")}
                    value={t("workspace.meta.pendingPermissions", { count: pendingPermissions })}
                  />
                )}
              </div>
            </div>

            <TimelineView timeline={timeline} onLoadOlder={loadOlder} />

            {agent.pendingPermissions.length > 0 && (
              <div className="mt-4">
                <PermissionRequests
                  requests={agent.pendingPermissions}
                  onRespond={(requestId, response) =>
                    dashboardRuntime.respondToPermission(
                      context.host.id,
                      agent.id,
                      requestId,
                      response,
                    )
                  }
                />
              </div>
            )}
          </section>
        </div>
      )}

      {view === "timeline" && (
        <footer className="workspace-composer" aria-label={t("workspace.composerAria")}>
          <div className="workspace-composer-project">
            <Folder size={14} />
            <span>{project.projectName}</span>
          </div>
          <div className="workspace-composer-input">
            <textarea
              aria-label={t("workspace.messageInputAria")}
              placeholder={t("workspace.composerPlaceholder")}
              value={draft}
              disabled={sending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                void sendDraft();
              }}
            />
            <button
              className="workspace-composer-send"
              aria-label={t("workspace.send")}
              disabled={sending || draft.trim().length === 0}
              onClick={() => void sendDraft()}
            >
              {sending ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <ArrowUp size={17} />
              )}
            </button>
          </div>
        </footer>
      )}
    </>
  );
}
