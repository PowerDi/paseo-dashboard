import { Check, LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import { revealDelay, useReveal } from "@/lib/use-reveal";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useHostSyncStore } from "@/stores/host-sync-store";

function SettingRow({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="dashboard-list-row">
      <div className="dashboard-row-copy">
        <span className="dashboard-row-title">{title}</span>
        <span className="dashboard-row-description">{description}</span>
      </div>
      {action}
    </div>
  );
}

function LanguageSwitch() {
  const { i18n } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-1">
      {SUPPORTED_LANGUAGES.map((language) => {
        const isActive = i18n.language === language.code;
        return (
          <button
            key={language.code}
            className={cn(
              "cursor-pointer rounded-[var(--radius-sm)] px-3 py-1 text-[13px] transition-colors",
              isActive
                ? "bg-[var(--surface-muted)] text-[var(--foreground)]"
                : "text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)]",
            )}
            onClick={() => i18n.changeLanguage(language.code)}
          >
            {language.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const user = useAppStore((state) => state.user);
  const lastRevision = useHostSyncStore((state) => state.lastRevision);
  const syncStatus = useHostSyncStore((state) => state.syncStatus);
  const syncError = useHostSyncStore((state) => state.syncError);
  useReveal([i18n.language]);

  const syncing = syncStatus === "syncing";

  return (
    <>
      <header className="dashboard-screen-header">
        <h1 className="dashboard-screen-title">{t("settings.title")}</h1>
        <span className="dashboard-screen-subtitle">{t("settings.subtitle")}</span>
      </header>
      <div className="dashboard-screen-body">
        <div className="dashboard-page-column">
          <SectionLabel style={revealDelay(0)}>{t("settings.preferences")}</SectionLabel>
          <div data-reveal="" style={revealDelay(1)}>
            <SettingRow
              title={t("settings.language")}
              description={t("settings.languageHint")}
              action={<LanguageSwitch />}
            />
          </div>

          <div className="mt-8">
            <SectionLabel style={revealDelay(2)}>{t("settings.account")}</SectionLabel>
          </div>
          <div data-reveal="" style={revealDelay(3)}>
            <SettingRow
              title={t("settings.email")}
              description={user?.email ?? t("settings.emailUnknown")}
              action={<span />}
            />
          </div>

          <div className="mt-8">
            <SectionLabel style={revealDelay(4)}>{t("settings.security")}</SectionLabel>
          </div>
          <div data-reveal="" style={revealDelay(5)}>
            <SettingRow
              title={t("settings.sessionProtection")}
              description={t("settings.sessionProtectionHint")}
              action={<LockKeyhole size={16} className="shrink-0 text-[var(--success)]" />}
            />
            <SettingRow
              title={t("settings.capabilityStorage")}
              description={t("settings.capabilityStorageHint")}
              action={
                <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-[var(--success)]">
                  <Check size={14} />
                  {t("settings.encrypted")}
                </span>
              }
            />
          </div>

          <div className="mt-8">
            <SectionLabel style={revealDelay(6)}>{t("settings.sync")}</SectionLabel>
          </div>
          <div data-reveal="" style={revealDelay(7)}>
            <SettingRow
              title={t("settings.lastSyncRevision")}
              description={
                syncError
                  ? t("settings.syncFailed", { error: syncError })
                  : t("settings.lastSyncHint", { revision: lastRevision })
              }
              action={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncing}
                  onClick={() => void useHostSyncStore.getState().sync()}
                >
                  {syncing ? (
                    <LoaderCircle className="animate-spin" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {t("settings.syncNow")}
                </Button>
              }
            />
            <SettingRow
              title={t("settings.forceResync")}
              description={t("settings.forceResyncHint")}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncing}
                  onClick={() => void useHostSyncStore.getState().forceResync()}
                >
                  {t("settings.resync")}
                </Button>
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}
