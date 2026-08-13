import type { Host } from "@getpaseo/dashboard-shared";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DashboardHostRuntimeState } from "@/paseo/dashboardRuntime";
import { dashboardRuntime } from "@/paseo/dashboardRuntime";

interface ProjectOption {
  key: string;
  hostId: string;
  label: string;
  cwd: string;
}

interface NewSessionComposerProps {
  hosts: readonly Host[];
  runtimes: ReadonlyMap<string, DashboardHostRuntimeState>;
  onCreated: (hostId: string, agentId: string) => void;
}

const PROVIDERS = AGENT_PROVIDER_DEFINITIONS.filter(
  (definition) => definition.enabledByDefault !== false,
);

const SELECT_CLASS =
  "h-7 max-w-56 truncate rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-2 text-[12px] text-[var(--foreground-muted)] outline-none focus:border-[var(--border)]";

export function NewSessionComposer({ hosts, runtimes, onCreated }: NewSessionComposerProps) {
  const { t } = useTranslation();
  const [projectKey, setProjectKey] = useState("");
  const [provider, setProvider] = useState(PROVIDERS[0]?.id ?? "claude");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectOptions = useMemo(() => {
    const options: ProjectOption[] = [];
    for (const host of hosts) {
      const runtime = runtimes.get(host.id);
      if (runtime?.connection.status !== "connected") continue;
      for (const project of runtime.daemonData?.projects.data ?? []) {
        options.push({
          key: `${host.id}\u0000${project.projectId}`,
          hostId: host.id,
          label: `${host.label} · ${project.projectDisplayName}`,
          cwd: project.projectRootPath,
        });
      }
    }
    return options;
  }, [hosts, runtimes]);

  const selectedProject =
    projectOptions.find((option) => option.key === projectKey) ?? projectOptions[0] ?? null;
  const canSend = selectedProject !== null && prompt.trim().length > 0 && !creating;

  async function create() {
    if (!selectedProject || !canSend) return;
    setCreating(true);
    setError(null);
    try {
      const agent = await dashboardRuntime.createAgent(selectedProject.hostId, {
        provider,
        cwd: selectedProject.cwd,
        initialPrompt: prompt.trim(),
      });
      setPrompt("");
      onCreated(selectedProject.hostId, agent.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }

  return (
    <footer className="workspace-composer" aria-label={t("workspace.composerAria")}>
      <div className="flex items-center gap-2">
        <select
          className={SELECT_CLASS}
          aria-label={t("workspace.newSession.projectAria")}
          value={selectedProject?.key ?? ""}
          disabled={projectOptions.length === 0 || creating}
          onChange={(event) => setProjectKey(event.target.value)}
        >
          {projectOptions.length === 0 && (
            <option value="">{t("workspace.newSession.noProjects")}</option>
          )}
          {projectOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          aria-label={t("workspace.newSession.providerAria")}
          value={provider}
          disabled={creating}
          onChange={(event) => setProvider(event.target.value)}
        >
          {PROVIDERS.map((definition) => (
            <option key={definition.id} value={definition.id}>
              {definition.label}
            </option>
          ))}
        </select>
        {error && (
          <span className="truncate text-[12px] text-[var(--danger)]" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className="workspace-composer-input">
        <textarea
          aria-label={t("workspace.messageInputAria")}
          placeholder={t("workspace.newSession.promptPlaceholder")}
          value={prompt}
          disabled={creating}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            void create();
          }}
        />
        <button
          className="workspace-composer-send"
          aria-label={t("workspace.newSession.create")}
          disabled={!canSend}
          onClick={() => void create()}
        >
          {creating ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowUp size={17} />}
        </button>
      </div>
    </footer>
  );
}
