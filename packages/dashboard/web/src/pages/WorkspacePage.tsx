import {
  Archive,
  ArrowDown,
  Bot,
  Clock,
  Folder,
  GitBranch,
  ShieldQuestion,
  Square,
  Terminal,
} from "lucide-react";
import type { Host } from "@getpaseo/dashboard-shared";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ComposerField, ComposerSendButton, ComposerShell } from "@/components/composer-shell";
import { useErrorAlert } from "@/components/error-alert";
import { NewSessionComposer } from "@/components/new-session-composer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PermissionRequests } from "@/components/permission-requests";
import { TimelineView } from "@/components/timeline";
import { WorkspaceTerminal } from "@/components/workspace-terminal";
import { Button } from "@/components/ui/button";
import { useAgentTimeline } from "@/hooks/use-agent-timeline";
import { useAutosizeTextarea } from "@/hooks/use-autosize-textarea";
import type { AgentContext } from "@/lib/agent-tree";
import { getDaemonFeatures } from "@/paseo/features";
import { sessionStatus } from "@/lib/agent-tree";
import { formatDateTime } from "@/lib/format-time";
import { deriveLiveActivity } from "@/lib/live-activity";
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
  preselectedProjectKey: string | null;
}

/** Distance from the bottom that still counts as "following the stream". */
const PIN_THRESHOLD_PX = 160;

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
  preselectedProjectKey,
}: WorkspacePageProps) {
  const { t, i18n } = useTranslation();
  const showError = useErrorAlert();
  const [draft, setDraft] = useState("");
  const draftRef = useAutosizeTextarea(draft);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<"cancel" | "archive" | null>(null);
  const [view, setView] = useState<"timeline" | "terminal">("timeline");
  const [providersSnapshot, setProvidersSnapshot] = useState<readonly ProviderSnapshotEntry[]>([]);
  const agentId = context?.entry.agent.id ?? null;
  const hostId = context?.host.id ?? null;
  const { timeline, loadOlder } = useAgentTimeline(hostId, agentId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastSeqRef = useRef<number>(-1);
  const [atBottom, setAtBottom] = useState(true);
  const status = context ? sessionStatus(context.entry.agent.status) : "idle";
  const latestSubmission = timeline?.submissions.at(-1);
  const liveActivity = deriveLiveActivity({
    status,
    entries: timeline?.entries ?? [],
    pendingPrompt: latestSubmission ? { startedAt: latestSubmission.startedAt } : undefined,
  });

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
    if (isFirstPaint || distanceFromBottom < PIN_THRESHOLD_PX) {
      container.scrollTop = container.scrollHeight;
      setAtBottom(true);
    }
  }, [timeline?.maxSeq]);

  useEffect(() => {
    lastSeqRef.current = -1;
    setAtBottom(true);
    setView("timeline");
    setDraft("");
    setProvidersSnapshot([]);
  }, [agentId]);

  // Fetch provider models when the agent is loaded and the daemon supports config apply.
  const supportsConfigApply = (() => {
    if (!hostId) return false;
    const serverInfo = dashboardRuntime.getServerInfo(hostId);
    return getDaemonFeatures(serverInfo).agentConfigApply;
  })();

  const availableModels = (() => {
    const providerName = context?.entry.agent.provider ?? "";
    const providerEntry = providersSnapshot.find((entry) => entry.provider === providerName);
    return providerEntry?.models ?? [];
  })();

  useEffect(() => {
    const agentProvider = context?.entry.agent.provider;
    const agentCwd = context?.entry.agent.cwd;
    if (!hostId || !supportsConfigApply || !agentProvider) return;
    let cancelled = false;
    void dashboardRuntime
      .getProvidersSnapshot(hostId, agentCwd)
      .then((entries) => {
        if (!cancelled) setProvidersSnapshot(entries);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hostId, supportsConfigApply, context?.entry.agent.provider, context?.entry.agent.cwd]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setAtBottom(distanceFromBottom < PIN_THRESHOLD_PX);
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

  async function sendDraft() {
    if (!hostId || !agentId || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await dashboardRuntime.sendAgentMessage(hostId, agentId, text);
      setDraft("");
    } catch (error) {
      showError(
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
        showError(
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
        <NewSessionComposer
          hosts={hosts}
          runtimes={runtimes}
          onCreated={onSelectAgent}
          preselectedProjectKey={preselectedProjectKey}
        />
      </>
    );
  }

  const { agent, project } = { agent: context.entry.agent, project: context.entry.project };
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
        <div className="workspace-header-tools">
          <span className="workspace-header-status">
            <span
              className={cn("dashboard-status-dot", status === "running" && "status-dot-pulse")}
              aria-label={status}
              style={{ background: statusColor(status) }}
            />
            <span className="workspace-header-context">
              {t(`agents.status.${status}`)} · {agent.provider}
            </span>
          </span>
          <div
            className="workspace-header-tabs"
            role="tablist"
            aria-label={t("workspace.view.timeline")}
          >
            {(["timeline", "terminal"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={view === candidate}
                className="workspace-header-tab"
                onClick={() => setView(candidate)}
              >
                {t(`workspace.view.${candidate}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
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
        <div className="workspace-thread-viewport">
          <div className="workspace-thread-scroll" ref={scrollRef} onScroll={handleScroll}>
            <section
              className="workspace-thread"
              aria-label={t("workspace.messagesAria", { title })}
            >
              <div className="mb-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4">
                <div className="space-y-2.5">
                  <div className="flex items-baseline gap-2 text-[13px]">
                    <span className="inline-flex w-24 shrink-0 items-center gap-1.5 text-[var(--foreground-subtle)]">
                      <span className="translate-y-[1px]">
                        <Bot size={13} />
                      </span>
                      {t("workspace.meta.provider")}
                    </span>
                    <div className="min-w-0 break-all text-[var(--foreground-muted)]">
                      {supportsConfigApply && availableModels.length > 0 ? (
                        <Select
                          value={agent.model ?? ""}
                          onValueChange={async (modelId) => {
                            if (!hostId || !agentId) return;
                            try {
                              await dashboardRuntime.applyAgentConfig(hostId, agentId, {
                                modelId,
                              });
                            } catch (error) {
                              showError(
                                t("agents.actionFailed", {
                                  message: error instanceof Error ? error.message : String(error),
                                }),
                              );
                            }
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="inline-flex w-auto max-w-[240px] gap-1"
                          >
                            <SelectValue placeholder={agent.provider} />
                          </SelectTrigger>
                          <SelectContent position="popper" align="start" side="top" sideOffset={6}>
                            {availableModels.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span>
                          {agent.model ? `${agent.provider} · ${agent.model}` : agent.provider}
                        </span>
                      )}
                    </div>
                  </div>
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

              <TimelineView
                timeline={timeline}
                liveActivity={liveActivity}
                pendingUserMessages={timeline?.submissions ?? []}
                onLoadOlder={loadOlder}
              />

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
          {!atBottom && (
            <button
              type="button"
              className="workspace-scroll-bottom"
              aria-label={t("workspace.scrollToBottom")}
              onClick={scrollToBottom}
            >
              <ArrowDown size={15} />
            </button>
          )}
        </div>
      )}

      {view === "timeline" && (
        <ComposerShell
          label={t("workspace.composerAria")}
          bar={
            <span className="composer-chip is-static">
              <Folder size={13} className="shrink-0 opacity-70" />
              <span>{project.projectName}</span>
            </span>
          }
          hint={t("workspace.submitHint")}
          actions={
            <ComposerSendButton
              label={t("workspace.send")}
              busy={sending}
              disabled={sending || draft.trim().length === 0}
              onClick={() => void sendDraft()}
            />
          }
        >
          <ComposerField
            ref={draftRef}
            label={t("workspace.messageInputAria")}
            placeholder={t("workspace.composerPlaceholder")}
            value={draft}
            disabled={sending}
            onChange={setDraft}
            onSubmit={() => void sendDraft()}
          />
        </ComposerShell>
      )}
    </>
  );
}
