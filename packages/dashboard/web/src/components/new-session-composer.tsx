import type { Host } from "@getpaseo/dashboard-shared";
import { AGENT_PROVIDER_DEFINITIONS } from "@getpaseo/protocol/provider-manifest";
import { Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ComposerField, ComposerSendButton, ComposerShell } from "@/components/composer-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutosizeTextarea } from "@/hooks/use-autosize-textarea";
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
  preselectedProjectKey: string | null;
}

const PROVIDERS = AGENT_PROVIDER_DEFINITIONS.filter(
  (definition) => definition.enabledByDefault !== false,
);

const CHIP_CLASS = "composer-chip";

export function NewSessionComposer({
  hosts,
  runtimes,
  onCreated,
  preselectedProjectKey,
}: NewSessionComposerProps) {
  const { t } = useTranslation();
  const [projectKey, setProjectKey] = useState(preselectedProjectKey ?? "");
  const [provider, setProvider] = useState(PROVIDERS[0]?.id ?? "claude");
  const [prompt, setPrompt] = useState("");
  const promptRef = useAutosizeTextarea(prompt);
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
    <ComposerShell
      label={t("workspace.composerAria")}
      bar={
        <>
          <Select
            value={selectedProject?.key ?? ""}
            disabled={projectOptions.length === 0 || creating}
            onValueChange={setProjectKey}
          >
            <SelectTrigger
              size="sm"
              className={CHIP_CLASS}
              aria-label={t("workspace.newSession.projectAria")}
            >
              <Folder size={13} className="shrink-0 opacity-70" />
              <SelectValue placeholder={t("workspace.newSession.noProjects")} />
            </SelectTrigger>
            <SelectContent position="popper" align="start" side="top" sideOffset={6}>
              {projectOptions.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={provider} disabled={creating} onValueChange={setProvider}>
            <SelectTrigger
              size="sm"
              className={CHIP_CLASS}
              aria-label={t("workspace.newSession.providerAria")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" side="top" sideOffset={6}>
              {PROVIDERS.map((definition) => (
                <SelectItem key={definition.id} value={definition.id}>
                  {definition.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
      hint={
        error ? (
          <span className="text-[var(--danger)]" role="alert">
            {error}
          </span>
        ) : (
          t("workspace.submitHint")
        )
      }
      actions={
        <ComposerSendButton
          label={t("workspace.newSession.create")}
          busy={creating}
          disabled={!canSend}
          onClick={() => void create()}
        />
      }
    >
      <ComposerField
        ref={promptRef}
        label={t("workspace.messageInputAria")}
        placeholder={t("workspace.newSession.promptPlaceholder")}
        value={prompt}
        disabled={creating}
        onChange={setPrompt}
        onSubmit={() => void create()}
      />
    </ComposerShell>
  );
}
