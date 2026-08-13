import type { Device, Session } from "@getpaseo/dashboard-shared";
import { LoaderCircle, Monitor, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import { listDevices, listSessions, revokeDevice, revokeSession } from "@/api/dashboardApi";
import { formatRelativeTime } from "@/lib/format-time";
import { revealDelay, useReveal } from "@/lib/use-reveal";

type SessionWithCurrent = Session & { isCurrentSession: boolean };

function StateText({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "muted" | "success" | "danger";
}) {
  const className = {
    muted: "text-[var(--foreground-subtle)]",
    success: "text-[var(--success)]",
    danger: "text-[var(--danger)]",
  }[tone];

  return <span className={`shrink-0 text-[13px] ${className}`}>{children}</span>;
}

export function DevicesPage() {
  const { t, i18n } = useTranslation();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [sessions, setSessions] = useState<SessionWithCurrent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = devices === null && sessions === null && error === null;
  useReveal([loading]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [deviceList, sessionList] = await Promise.all([listDevices(), listSessions()]);
      setDevices(deviceList);
      setSessions(sessionList);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevokeDevice(deviceId: string) {
    await revokeDevice(deviceId).catch(() => undefined);
    await load();
  }

  async function handleRevokeSession(sessionId: string) {
    await revokeSession(sessionId).catch(() => undefined);
    await load();
  }

  return (
    <>
      <header className="dashboard-screen-header">
        <h1 className="dashboard-screen-title">{t("devices.title")}</h1>
      </header>
      <div className="dashboard-screen-body">
        <div className="dashboard-page-column">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--foreground-faint)]">
              <LoaderCircle className="animate-spin" size={14} />
              {t("common.loading")}
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-[13px] text-[var(--danger)]">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t("common.retry")}
              </Button>
            </div>
          )}

          {devices && (
            <>
              <SectionLabel style={revealDelay(0)}>{t("devices.devicesSection")}</SectionLabel>
              <div data-reveal="" style={revealDelay(1)}>
                {devices.map((device) => (
                  <div key={device.id} className="dashboard-list-row">
                    <Monitor size={16} className="shrink-0 text-[var(--foreground-subtle)]" />
                    <div className="dashboard-row-copy">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="dashboard-row-title">{device.displayName}</span>
                        {device.isCurrentDevice && (
                          <StateText tone="success">{t("devices.thisDevice")}</StateText>
                        )}
                        {device.revokedAt && (
                          <StateText tone="danger">{t("devices.revoked")}</StateText>
                        )}
                      </div>
                      <span className="dashboard-row-description">
                        {t("devices.deviceMeta", {
                          platform: device.platform,
                          firstSeen: formatRelativeTime(device.firstSeenAt, i18n.language),
                          lastSeen: formatRelativeTime(device.lastSeenAt, i18n.language),
                        })}
                      </span>
                    </div>
                    {!device.isCurrentDevice && !device.revokedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[var(--foreground-subtle)] hover:text-[var(--danger)]"
                        onClick={() => void handleRevokeDevice(device.id)}
                      >
                        <ShieldAlert size={14} />
                        {t("devices.revoke")}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {sessions && (
            <>
              <div className="mt-8">
                <SectionLabel style={revealDelay(2)}>{t("devices.sessionsSection")}</SectionLabel>
              </div>
              <div data-reveal="" style={revealDelay(3)}>
                {sessions.map((session) => (
                  <div key={session.id} className="dashboard-list-row">
                    <span
                      className="dashboard-status-dot"
                      style={{ background: "var(--success)" }}
                    />
                    <div className="dashboard-row-copy">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="dashboard-row-title">{session.deviceName}</span>
                        {session.isCurrentSession && (
                          <StateText tone="success">{t("devices.current")}</StateText>
                        )}
                      </div>
                      <span className="dashboard-row-description">
                        {t("devices.sessionMeta", {
                          createdAt: formatRelativeTime(session.createdAt, i18n.language),
                          lastUsedAt: formatRelativeTime(session.lastUsedAt, i18n.language),
                        })}
                      </span>
                    </div>
                    {!session.isCurrentSession && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-[var(--foreground-muted)] hover:text-[var(--danger)]"
                        title={t("devices.revokeSession")}
                        onClick={() => void handleRevokeSession(session.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
