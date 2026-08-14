import {
  Bot,
  ChevronRight,
  Folder,
  KeyRound,
  LoaderCircle,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Search,
  Server,
  Settings,
  Shield,
  SquarePen,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SessionStatusMarker } from "@/components/session-status-marker";
import type {
  HostPresence,
  SidebarHostNode,
  SidebarProjectNode,
  SidebarSessionNode,
} from "@/lib/agent-tree";
import { cn } from "@/lib/utils";

export type Page = "workspace" | "hosts" | "agents" | "devices" | "audit" | "settings";

interface ShellProps {
  page: Page;
  onPageChange: (page: Page) => void;
  children: ReactNode;
  onAddHost: () => void;
  onLogout: () => void;
  onNewSession: () => void;
  hosts: SidebarHostNode[];
  selectedAgentId: string | null;
  onSelectSession: (session: SidebarSessionNode) => void;
  onSelectProjectForNewSession: (project: SidebarProjectNode) => void;
}

const secondaryNav: {
  id: Page;
  labelKey: "hosts" | "agents" | "devices" | "audit";
  icon: ReactNode;
}[] = [
  { id: "hosts", labelKey: "hosts", icon: <Server size={16} /> },
  { id: "agents", labelKey: "agents", icon: <Bot size={16} /> },
  { id: "devices", labelKey: "devices", icon: <KeyRound size={16} /> },
  { id: "audit", labelKey: "audit", icon: <Shield size={16} /> },
];

function presenceColor(presence: HostPresence): string {
  if (presence === "online") return "var(--success)";
  if (presence === "connecting") return "var(--warning)";
  return "var(--foreground-faint)";
}

export function Shell({
  page,
  onPageChange,
  children,
  onAddHost,
  onLogout,
  onNewSession,
  hosts,
  selectedAgentId,
  onSelectSession,
  onSelectProjectForNewSession,
}: ShellProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  // Hosts load asynchronously, so track the rows the user closed instead of
  // the ones that are open — new data arrives expanded by default.
  const [closedHosts, setClosedHosts] = useState<Set<string>>(new Set());
  const [closedProjects, setClosedProjects] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    scrollRef.current?.toggleAttribute("inert", collapsed);
    footerRef.current?.toggleAttribute("inert", collapsed);
  }, [collapsed]);

  function toggle(set: Set<string>, id: string, setter: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  return (
    <div className="dashboard-shell">
      <aside className={cn("dashboard-sidebar", collapsed && "is-collapsed")}>
        <header className="dashboard-sidebar-header">
          {collapsed ? (
            <button
              className="dashboard-sidebar-search"
              aria-label={t("nav.expandSidebar")}
              title={t("nav.expandSidebar")}
              onClick={() => setCollapsed(false)}
            >
              <PanelLeft size={16} />
            </button>
          ) : (
            <>
              <span className="dashboard-brand-copy">Paseo</span>
              <button
                className="dashboard-sidebar-search"
                aria-label={t("nav.search")}
                title={t("nav.search")}
              >
                <Search size={17} />
              </button>
              <button
                className="dashboard-sidebar-search !ml-0"
                aria-label={t("nav.collapseSidebar")}
                title={t("nav.collapseSidebar")}
                onClick={() => setCollapsed(true)}
              >
                <PanelLeftClose size={16} />
              </button>
            </>
          )}
        </header>

        <div
          ref={scrollRef}
          className="dashboard-sidebar-scroll"
          aria-hidden={collapsed || undefined}
        >
          <nav className="dashboard-nav" aria-label="Primary">
            <button
              className={cn("dashboard-nav-item", page === "workspace" && "is-selected")}
              onClick={onNewSession}
            >
              <SquarePen size={16} />
              <span>{t("nav.newSession")}</span>
            </button>

            {secondaryNav.map((item) => (
              <button
                key={item.id}
                className={cn("dashboard-nav-item", page === item.id && "is-selected")}
                onClick={() => onPageChange(item.id)}
              >
                {item.icon}
                <span>{t(`nav.${item.labelKey}`)}</span>
              </button>
            ))}
          </nav>

          <section aria-labelledby="projects-heading">
            <h2 id="projects-heading" className="dashboard-sidebar-label">
              {t("nav.projects")}
            </h2>
            <div className="dashboard-tree">
              {hosts.length === 0 && (
                <p className="px-2 py-1 text-xs text-[var(--foreground-faint)]">
                  {t("nav.noHosts")}
                </p>
              )}
              {hosts.map((host) => {
                const isOpen = !closedHosts.has(host.id);
                return (
                  <div key={host.id}>
                    <button
                      className="dashboard-tree-row"
                      aria-expanded={isOpen}
                      onClick={() => toggle(closedHosts, host.id, setClosedHosts)}
                    >
                      <ChevronRight
                        className={cn("tree-chevron", isOpen && "is-expanded")}
                        size={12}
                      />
                      <Server size={14} />
                      <span className="tree-label">{host.label}</span>
                      {host.loading ? (
                        <LoaderCircle
                          className="animate-spin text-[var(--foreground-faint)]"
                          size={12}
                        />
                      ) : (
                        <span
                          className="dashboard-status-dot"
                          aria-label={t(`hosts.status.${host.presence}`)}
                          style={{ background: presenceColor(host.presence) }}
                        />
                      )}
                    </button>

                    <div className={cn("collapsible", isOpen && "is-open")}>
                      <div className="collapsible-inner">
                        {host.dataError && (
                          <p className="px-2 py-1 text-xs text-[var(--danger)]">
                            {t("nav.hostDataError")}
                          </p>
                        )}
                        {host.projects.map((project) => {
                          const projectOpen = !closedProjects.has(project.id);
                          return (
                            <div key={project.id} className="dashboard-tree-project">
                              <button
                                className="dashboard-tree-row project"
                                aria-expanded={projectOpen}
                                onClick={() =>
                                  toggle(closedProjects, project.id, setClosedProjects)
                                }
                              >
                                <ChevronRight
                                  className={cn("tree-chevron", projectOpen && "is-expanded")}
                                  size={12}
                                />
                                <Folder size={13} />
                                <span className="tree-label">{project.label}</span>
                              </button>
                              <button
                                className="dashboard-tree-action"
                                aria-label={t("nav.newSessionInProject")}
                                title={t("nav.newSessionInProject")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectProjectForNewSession(project);
                                }}
                              >
                                <Plus size={12} />
                              </button>

                              <div className={cn("collapsible", projectOpen && "is-open")}>
                                <div className="collapsible-inner">
                                  {project.sessions.map((session) => (
                                    <button
                                      key={session.id}
                                      className={cn(
                                        "dashboard-tree-row session",
                                        selectedAgentId === session.id && "is-selected",
                                      )}
                                      onClick={() => onSelectSession(session)}
                                    >
                                      <SessionStatusMarker
                                        status={session.status}
                                        label={t(`agents.status.${session.status}`)}
                                      />
                                      <span className="tree-label">
                                        {session.title ?? t("nav.untitledSession")}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <button className="dashboard-sidebar-action" onClick={onAddHost}>
            <span className="dashboard-sidebar-action-icon" aria-hidden="true">
              <Plus size={13} />
            </span>
            <span>{t("nav.addHost")}</span>
          </button>
        </div>

        <footer
          ref={footerRef}
          className="dashboard-sidebar-footer"
          aria-hidden={collapsed || undefined}
        >
          <button
            className={cn("dashboard-nav-item", page === "settings" && "is-selected")}
            onClick={() => onPageChange("settings")}
          >
            <Settings size={16} />
            <span>{t("nav.settings")}</span>
          </button>
          <button onClick={onLogout}>
            <LogOut size={16} />
            <span>{t("nav.logout")}</span>
          </button>
        </footer>
      </aside>

      <main className="dashboard-main">{children}</main>
    </div>
  );
}
