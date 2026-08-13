import type { Host } from "@getpaseo/dashboard-shared";
import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dashboardApi, deleteHost } from "./api/dashboardApi";
import { useHostRuntimes } from "./hooks/use-host-runtimes";
import { Shell, type Page } from "./layouts/Shell";
import { buildHostNodes, findAgentContext } from "./lib/agent-tree";
import { AgentsPage } from "./pages/AgentsPage";
import { DevicesPage } from "./pages/DevicesPage";
import { HostsPage } from "./pages/HostsPage";
import { ImportHostModal } from "./pages/ImportHostModal";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { dashboardRuntime } from "./paseo/dashboardRuntime";
import { useAppStore } from "./stores/app-store";
import { useHostSyncStore } from "./stores/host-sync-store";
import { Button } from "./components/ui/button";

const MODAL_CLOSE_MS = 180;

interface AgentSelection {
  hostId: string;
  agentId: string;
}

function CenteredScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--background)] p-4">
      {children}
    </div>
  );
}

export function App() {
  const status = useAppStore((state) => state.status);
  const bootstrapError = useAppStore((state) => state.bootstrapError);
  const { t } = useTranslation();

  useEffect(() => {
    void useAppStore.getState().bootstrap();
  }, []);

  if (status === "checking") {
    return (
      <CenteredScreen>
        <LoaderCircle className="animate-spin text-[var(--foreground-faint)]" size={20} />
      </CenteredScreen>
    );
  }

  if (status === "unauthenticated") {
    return <LoginPage />;
  }

  if (status === "error") {
    return (
      <CenteredScreen>
        <p className="text-[13px] text-[var(--danger)]">{bootstrapError}</p>
        <Button size="sm" variant="outline" onClick={() => void useAppStore.getState().bootstrap()}>
          {t("common.retry")}
        </Button>
      </CenteredScreen>
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const [page, setPage] = useState<Page>("workspace");
  const [showImport, setShowImport] = useState(false);
  const [importClosing, setImportClosing] = useState(false);
  const importCloseTimer = useRef<number | null>(null);
  const [selection, setSelection] = useState<AgentSelection | null>(null);

  const hostsMap = useHostSyncStore((state) => state.hosts);
  const hosts = useMemo(() => [...hostsMap.values()], [hostsMap]);
  const runtimes = useHostRuntimes(hosts);
  const hostNodes = useMemo(() => buildHostNodes(hosts, runtimes), [hosts, runtimes]);
  const selectedContext = selection
    ? findAgentContext(hosts, runtimes, selection.hostId, selection.agentId)
    : null;

  // Connect every known host; disconnect hosts that left the registry.
  const connectedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(hosts.map((host) => host.id));
    for (const host of hosts) {
      if (connectedIdsRef.current.has(host.id)) continue;
      connectedIdsRef.current.add(host.id);
      void dashboardRuntime.connectHost(host).catch(() => {
        // Connection state is surfaced through the runtime subscription.
      });
    }
    // Deleting the current entry while iterating a Set is safe.
    for (const hostId of connectedIdsRef.current) {
      if (currentIds.has(hostId)) continue;
      connectedIdsRef.current.delete(hostId);
      void dashboardRuntime.disconnectHost(hostId).catch(() => undefined);
    }
  }, [hosts]);

  useEffect(
    () => () => {
      connectedIdsRef.current.clear();
      void dashboardRuntime.disconnectAll().catch(() => undefined);
    },
    [],
  );

  // Config events keep the host registry current across devices.
  useEffect(() => {
    const subscription = dashboardApi.subscribeConfigEvents((event) => {
      if (event.type === "host.upserted" || event.type === "host.deleted") {
        void useHostSyncStore.getState().sync();
      }
    });
    return () => subscription.close();
  }, []);

  useEffect(
    () => () => {
      if (importCloseTimer.current !== null) window.clearTimeout(importCloseTimer.current);
    },
    [],
  );

  function openImport() {
    if (importCloseTimer.current !== null) {
      window.clearTimeout(importCloseTimer.current);
      importCloseTimer.current = null;
    }
    setImportClosing(false);
    setShowImport(true);
  }

  function closeImport() {
    if (importCloseTimer.current !== null) return;
    setImportClosing(true);
    importCloseTimer.current = window.setTimeout(() => {
      importCloseTimer.current = null;
      setShowImport(false);
      setImportClosing(false);
    }, MODAL_CLOSE_MS);
  }

  async function handleRemoveHost(host: Host) {
    await deleteHost(host.id).catch(() => undefined);
    await useHostSyncStore.getState().sync();
    if (selection?.hostId === host.id) setSelection(null);
  }

  function selectAgent(hostId: string, agentId: string) {
    setSelection({ hostId, agentId });
    setPage("workspace");
  }

  async function cancelAgent(hostId: string, agentId: string) {
    await dashboardRuntime.cancelAgent(hostId, agentId);
  }

  async function archiveAgent(hostId: string, agentId: string) {
    await dashboardRuntime.archiveAgent(hostId, agentId);
    if (selection?.hostId === hostId && selection.agentId === agentId) {
      setSelection(null);
    }
  }

  async function resumeAgent(hostId: string, agentId: string) {
    const agent = await dashboardRuntime.resumeAgent(hostId, agentId);
    selectAgent(hostId, agent.id);
  }

  return (
    <>
      <Shell
        page={page}
        onPageChange={setPage}
        onAddHost={openImport}
        onLogout={() => void useAppStore.getState().logout()}
        hosts={hostNodes}
        selectedAgentId={selection?.agentId ?? null}
        onSelectSession={(session) => selectAgent(session.hostId, session.id)}
      >
        <div key={page} className="dashboard-page-enter flex min-h-0 flex-1 flex-col">
          {page === "workspace" && (
            <WorkspacePage
              context={selectedContext}
              hosts={hosts}
              runtimes={runtimes}
              onSelectAgent={selectAgent}
              onCancelAgent={cancelAgent}
              onArchiveAgent={archiveAgent}
            />
          )}
          {page === "hosts" && (
            <HostsPage
              hosts={hosts}
              runtimes={runtimes}
              onAddHost={openImport}
              onRemoveHost={(host) => void handleRemoveHost(host)}
            />
          )}
          {page === "agents" && (
            <AgentsPage
              hosts={hosts}
              runtimes={runtimes}
              selectedAgentId={selection?.agentId ?? null}
              onSelectAgent={selectAgent}
              onCancelAgent={cancelAgent}
              onArchiveAgent={archiveAgent}
              onResumeAgent={resumeAgent}
            />
          )}
          {page === "devices" && <DevicesPage />}
          {page === "settings" && <SettingsPage />}
        </div>
      </Shell>

      {showImport && (
        <ImportHostModal dataState={importClosing ? "closed" : "open"} onClose={closeImport} />
      )}
    </>
  );
}
