import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { Passkey } from "@getpaseo/dashboard-shared";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import { formatRelativeTime } from "@/lib/format-time";
import { revealDelay, useReveal } from "@/lib/use-reveal";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { useThemeStore } from "@/stores/theme-store";
import { useHostSyncStore } from "@/stores/host-sync-store";
import {
  beginPasskeyRegistration,
  changePassword,
  deletePasskey,
  finishPasskeyRegistration,
  listPasskeys,
} from "@/api/dashboardApi";

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

function ThemeSwitch() {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--surface-soft)] p-1">
      {(["dark", "light"] as const).map((value) => (
        <button
          key={value}
          className={cn(
            "cursor-pointer rounded-[var(--radius-sm)] px-3 py-1 text-[13px] transition-colors",
            theme === value
              ? "bg-[var(--surface-muted)] text-[var(--foreground)]"
              : "text-[var(--foreground-subtle)] hover:text-[var(--foreground-muted)]",
          )}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
        >
          {t(`settings.theme.${value}`)}
        </button>
      ))}
    </div>
  );
}

function ChangePasswordSection() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword.length < 8) {
      setError(t("settings.changePassword.tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.changePassword.mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      await changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="dashboard-list-row !flex-col !items-stretch gap-3">
      <div className="flex items-center justify-between">
        <div className="dashboard-row-copy">
          <span className="dashboard-row-title">{t("settings.changePassword.title")}</span>
          <span className="dashboard-row-description">{t("settings.changePassword.hint")}</span>
        </div>
        {success && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-[var(--success)]">
            <Check size={14} />
            {t("settings.changePassword.success")}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-[13px] text-[var(--foreground-muted)]">
            {t("settings.changePassword.current")}
          </span>
          <div className="relative flex-1">
            <input
              type={showCurrent ? "text" : "password"}
              autoComplete="current-password"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--foreground-muted)]"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--foreground-faint)]"
              onClick={() => setShowCurrent((v) => !v)}
            >
              {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-[13px] text-[var(--foreground-muted)]">
            {t("settings.changePassword.new")}
          </span>
          <div className="relative flex-1">
            <input
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--foreground-muted)]"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--foreground-faint)]"
              onClick={() => setShowNew((v) => !v)}
            >
              {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-[13px] text-[var(--foreground-muted)]">
            {t("settings.changePassword.confirm")}
          </span>
          <input
            type={showNew ? "text" : "password"}
            autoComplete="new-password"
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--foreground-muted)]"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </label>
      </div>
      {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting && <LoaderCircle className="animate-spin" size={14} />}
          {t("settings.changePassword.submit")}
        </Button>
      </div>
    </form>
  );
}

function PasskeySection() {
  const { t, i18n } = useTranslation();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = browserSupportsWebAuthn();

  const load = useCallback(async () => {
    try {
      setPasskeys(await listPasskeys());
    } catch (cause) {
      setPasskeys([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!supported || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const ceremony = await beginPasskeyRegistration(currentPassword);
      const response = await startRegistration({ optionsJSON: ceremony.options });
      const result = await finishPasskeyRegistration(ceremony.ceremonyId, response, name);
      setPasskeys((current) => [result.passkey, ...(current ?? [])]);
      setName("");
      setCurrentPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.passkeys.addFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(passkeyId: string) {
    if (deletingId) return;
    setDeletingId(passkeyId);
    setError(null);
    try {
      await deletePasskey(passkeyId);
      setPasskeys((current) => current?.filter((passkey) => passkey.id !== passkeyId) ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.passkeys.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  const inputClassName =
    "min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--foreground-muted)] disabled:opacity-50";

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]">
      <div className="dashboard-list-row border-b border-[var(--border)]">
        <KeyRound size={16} className="shrink-0 text-[var(--foreground-subtle)]" />
        <div className="dashboard-row-copy">
          <span className="dashboard-row-title">{t("settings.passkeys.title")}</span>
          <span className="dashboard-row-description">
            {supported ? t("settings.passkeys.hint") : t("settings.passkeys.unsupported")}
          </span>
        </div>
      </div>

      {passkeys === null ? (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-[13px] text-[var(--foreground-faint)]">
          <LoaderCircle className="animate-spin" size={14} />
          {t("common.loading")}
        </div>
      ) : passkeys.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-[var(--foreground-subtle)]">
          {t("settings.passkeys.empty")}
        </p>
      ) : (
        passkeys.map((passkey) => (
          <div
            key={passkey.id}
            className="dashboard-list-row border-t border-[var(--border)] first:border-t-0"
          >
            <div className="dashboard-row-copy">
              <span className="dashboard-row-title">{passkey.name}</span>
              <span className="dashboard-row-description">
                {t("settings.passkeys.meta", {
                  type: t(`settings.passkeys.deviceType.${passkey.deviceType}`),
                  backup: passkey.backedUp
                    ? t("settings.passkeys.backedUp")
                    : t("settings.passkeys.notBackedUp"),
                  createdAt: formatRelativeTime(passkey.createdAt, i18n.language),
                  lastUsedAt: passkey.lastUsedAt
                    ? formatRelativeTime(passkey.lastUsedAt, i18n.language)
                    : t("settings.passkeys.neverUsed"),
                })}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-[var(--foreground-muted)] hover:text-[var(--danger)]"
              disabled={deletingId !== null}
              title={t("settings.passkeys.delete")}
              onClick={() => void handleDelete(passkey.id)}
            >
              {deletingId === passkey.id ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <Trash2 size={14} />
              )}
            </Button>
          </div>
        ))
      )}

      <form
        className="flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--surface-soft)] px-4 py-4"
        onSubmit={handleAdd}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClassName}
            disabled={!supported || submitting}
            maxLength={80}
            placeholder={t("settings.passkeys.namePlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            autoComplete="current-password"
            className={inputClassName}
            disabled={!supported || submitting}
            placeholder={t("settings.passkeys.currentPassword")}
            required
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <Button disabled={!supported || submitting} size="sm" type="submit">
            {submitting && <LoaderCircle className="animate-spin" size={14} />}
            {t("settings.passkeys.add")}
          </Button>
        </div>
        {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
      </form>
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

          <div data-reveal="" style={revealDelay(2)}>
            <SettingRow
              title={t("settings.theme.title")}
              description={t("settings.theme.hint")}
              action={<ThemeSwitch />}
            />
          </div>

          <div className="mt-8">
            <SectionLabel style={revealDelay(3)}>{t("settings.account")}</SectionLabel>
          </div>
          <div data-reveal="" style={revealDelay(4)}>
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

          <div className="mt-4" data-reveal="" style={revealDelay(6)}>
            <ChangePasswordSection />
          </div>

          <div className="mt-4" data-reveal="" style={revealDelay(7)}>
            <PasskeySection />
          </div>

          <div className="mt-8">
            <SectionLabel style={revealDelay(8)}>{t("settings.sync")}</SectionLabel>
          </div>
          <div data-reveal="" style={revealDelay(9)}>
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
