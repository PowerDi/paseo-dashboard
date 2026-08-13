import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";

type Mode = "login" | "register";

export function LoginPage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const store = useAppStore.getState();
      if (mode === "login") await store.login(email.trim(), password);
      else await store.register(email.trim(), password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("login.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClassName =
    "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
      <div className="animate-rise flex w-full max-w-[360px] flex-col items-center">
        <span className="workspace-empty-mark" aria-hidden="true">
          P
        </span>
        <h1 className="mt-4 text-lg font-medium text-[var(--foreground)]">{t("login.title")}</h1>
        <p className="mt-1 text-[13px] text-[var(--foreground-subtle)]">
          {mode === "login" ? t("login.subtitle") : t("login.registerSubtitle")}
        </p>

        <form className="mt-8 w-full space-y-3" onSubmit={handleSubmit}>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--foreground-muted)]">
              {t("login.email")}
            </span>
            <input
              autoComplete="email"
              className={inputClassName}
              disabled={submitting}
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[var(--foreground-muted)]">
              {t("login.password")}
            </span>
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={inputClassName}
              disabled={submitting}
              minLength={8}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error && (
            <p className="rounded-md border border-[var(--danger)]/25 bg-[var(--danger)]/8 px-3 py-2 text-xs text-[var(--danger)]">
              {error}
            </p>
          )}

          <Button className="w-full" disabled={submitting} type="submit">
            {submitting && <LoaderCircle className="animate-spin" size={14} />}
            {mode === "login" ? t("login.signIn") : t("login.createAccount")}
          </Button>
        </form>

        <button
          className="mt-6 cursor-pointer text-[13px] text-[var(--foreground-subtle)] transition-colors hover:text-[var(--foreground-muted)]"
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? t("login.switchToRegister") : t("login.switchToLogin")}
        </button>
      </div>
    </div>
  );
}
