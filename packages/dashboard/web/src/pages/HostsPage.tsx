import type { Host } from "@getpaseo/dashboard-shared";
import { Bot, Link2, Pencil, Plus, Server, Trash2, Wifi } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import { hostPresence, isActiveAgent, type HostPresence } from "@/lib/agent-tree";
import { formatRelativeTime } from "@/lib/format-time";
import type { DashboardHostRuntimeState } from "@/paseo/dashboardRuntime";
import { revealDelay, useReveal } from "@/lib/use-reveal";

interface HostsPageProps {
  hosts: readonly Host[];
  runtimes: ReadonlyMap<string, DashboardHostRuntimeState>;
  onAddHost: () => void;
  onRemoveHost: (host: Host) => void;
  onRenameHost: (host: Host, label: string) => Promise<void>;
}

const statusTokens: Record<HostPresence, { color: string; className: string }> = {
  online: { color: "var(--success)", className: "text-[var(--success)]" },
  offline: { color: "#8a8a8a", className: "text-[var(--foreground-subtle)]" },
  connecting: { color: "var(--warning)", className: "text-[var(--warning)]" },
};

export function HostsPage({
  hosts,
  runtimes,
  onAddHost,
  onRemoveHost,
  onRenameHost,
}: HostsPageProps) {
  const { t, i18n } = useTranslation();
  useReveal([hosts.length]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  function startRename(host: Host) {
    setEditingId(host.id);
    setEditingLabel(host.label);
    setRenameError(null);
  }

  async function commitRename(host: Host) {
    const trimmed = editingLabel.trim();
    if (!trimmed || trimmed === host.label) {
      setEditingId(null);
      return;
    }
    try {
      await onRenameHost(host, trimmed);
      setEditingId(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    }
  }

  const online = hosts.filter((host) => hostPresence(runtimes.get(host.id)) === "online").length;

  return (
    <>
      <header className="dashboard-screen-header">
        <h1 className="dashboard-screen-title">{t("hosts.title")}</h1>
        <span className="dashboard-screen-subtitle">
          {t("hosts.subtitle", { count: hosts.length, online })}
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="text-[var(--foreground-muted)]"
            onClick={onAddHost}
          >
            <Plus size={14} />
            {t("hosts.addHost")}
          </Button>
        </div>
      </header>
      <div className="dashboard-screen-body">
        <div className="dashboard-page-column">
          <SectionLabel style={revealDelay(0)}>{t("hosts.connectedEnvironments")}</SectionLabel>
          <p className="dashboard-section-hint mb-3" data-reveal="" style={revealDelay(0)}>
            {t("hosts.hint")}
          </p>
          <div data-reveal="" style={revealDelay(1)}>
            {hosts.length === 0 && (
              <p className="py-6 text-center text-[13px] text-[var(--foreground-faint)]">
                {t("hosts.empty")}
              </p>
            )}
            {hosts.map((host) => {
              const runtime = runtimes.get(host.id);
              const presence = hostPresence(runtime);
              const status = statusTokens[presence];
              const agentCount = runtime?.daemonData?.agents.data.filter(isActiveAgent).length ?? 0;
              return (
                <div key={host.id} className="dashboard-list-row group">
                  <Server size={16} className="shrink-0 text-[var(--foreground-subtle)]" />
                  <div className="dashboard-row-copy">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="dashboard-row-title">{host.label}</span>
                      <span className="truncate font-mono text-xs text-[var(--foreground-faint)]">
                        {host.connection.serverId}
                      </span>
                    </div>
                    <div className="dashboard-row-description flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <Bot size={12} />
                        {t("hosts.agentsCount", { count: agentCount })}
                      </span>
                      <span className="opacity-40">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Link2 size={12} />
                        {host.connection.relayEndpoint}
                      </span>
                      <span className="opacity-40">·</span>
                      <span>{formatRelativeTime(host.updatedAt, i18n.language)}</span>
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 text-[13px] ${status.className}`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: status.color }}
                    />
                    {t(`hosts.status.${presence}`)}
                  </span>
                  {editingId === host.id ? (
                    <div className="ml-1 flex items-center gap-1">
                      <input
                        autoFocus
                        className="w-32 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--foreground-muted)]"
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        onBlur={() => void commitRename(host)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(host);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="ml-1 hidden items-center gap-1 group-hover:flex">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={t("hosts.renameHost")}
                        onClick={() => startRename(host)}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="hover:text-[var(--danger)]"
                        title={t("hosts.removeHost")}
                        onClick={() => onRemoveHost(host)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {renameError && (
            <p
              className="mt-2 text-[13px] text-[var(--danger)]"
              data-reveal=""
              style={revealDelay(2)}
            >
              {renameError}
            </p>
          )}
          <div
            className="mt-4 flex items-center gap-2 text-[13px] text-[var(--foreground-faint)]"
            data-reveal=""
            style={revealDelay(2)}
          >
            <Wifi size={13} />
            {t("hosts.availabilityNote")}
          </div>
        </div>
      </div>
    </>
  );
}
