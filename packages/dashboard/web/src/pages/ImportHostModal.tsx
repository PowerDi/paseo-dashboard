import type { Host } from "@getpaseo/dashboard-shared";
import { Link2, LoaderCircle, Wifi, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { importHost } from "@/api/dashboardApi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { dashboardRuntime } from "@/paseo/dashboardRuntime";
import { parseAndNormalizeOffer } from "@/paseo/offer";
import { useHostSyncStore } from "@/stores/host-sync-store";

interface ImportHostModalProps {
  onClose: () => void;
  dataState?: "open" | "closed";
}

type ImportStep = "input" | "verifying" | "success" | "error";

export function ImportHostModal({ onClose, dataState = "open" }: ImportHostModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<ImportStep>("input");
  const [offer, setOffer] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [importedLabel, setImportedLabel] = useState("");
  // Mount with data-state="closed" so the enter transition plays, then flip to
  // "open" after the first frames. Double rAF: the first fires before paint.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const resolvedState = dataState === "closed" ? "closed" : entered ? "open" : "closed";

  async function handleVerify() {
    setError("");
    setStep("verifying");

    try {
      const normalized = parseAndNormalizeOffer(offer);
      const resolvedLabel =
        label.trim() || t("importHost.defaultLabel", { id: normalized.connection.serverId });

      // Probe the daemon through the relay before persisting anything; the
      // temporary host never enters the sync store.
      const probeHost: Host = {
        id: `import-probe-${normalized.connection.serverId}`,
        label: resolvedLabel,
        version: 0,
        connection: normalized.connection,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const { serverVersion } = await dashboardRuntime.verifyConnection(probeHost);

      await importHost({
        label: resolvedLabel,
        connection: normalized.connection,
        clientVerification: {
          verifiedAt: new Date().toISOString(),
          serverVersion,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      await useHostSyncStore.getState().sync();
      setImportedLabel(resolvedLabel);
      setStep("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("importHost.invalidLink"));
      setStep("error");
    }
  }

  const isVerifying = step === "verifying";
  const isComplete = step === "success";
  const isClosed = resolvedState === "closed";

  return (
    <div
      className="dashboard-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      data-state={resolvedState}
      role="presentation"
      onClick={isClosed || isVerifying ? undefined : onClose}
    >
      <div
        aria-labelledby="import-host-title"
        aria-modal="true"
        className="dashboard-modal-panel w-full max-w-[480px] overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]"
        data-state={resolvedState}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-divider px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Wifi size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="import-host-title" className="text-sm font-medium">
              {t("importHost.title")}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("importHost.description")}
            </p>
          </div>
          <Button
            aria-label={t("importHost.close")}
            className="-mr-2 -mt-1 text-muted-foreground"
            disabled={isVerifying || isClosed}
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
          >
            <X size={15} />
          </Button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("importHost.hostLabel")}{" "}
              <span className="font-normal text-muted-foreground">{t("importHost.optional")}</span>
            </span>
            <input
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isVerifying || isComplete}
              placeholder={t("importHost.hostLabelPlaceholder")}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("importHost.pairingLink")}
            </span>
            <Textarea
              className="min-h-[104px] resize-y font-mono text-xs"
              disabled={isVerifying || isComplete}
              placeholder="https://app.paseo.sh/#offer=..."
              value={offer}
              onChange={(event) => setOffer(event.target.value)}
            />
          </label>

          {(isVerifying || isComplete || step === "error") && (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs",
                isComplete &&
                  "border-[var(--success)]/25 bg-[var(--success)]/8 text-[var(--success)]",
                isVerifying && "border-border-subtle bg-background text-muted-foreground",
                step === "error" &&
                  "border-[var(--danger)]/25 bg-[var(--danger)]/8 text-[var(--danger)]",
              )}
            >
              {isVerifying && <LoaderCircle className="mt-0.5 shrink-0 animate-spin" size={14} />}
              {isComplete && <Link2 className="mt-0.5 shrink-0" size={14} />}
              <span>
                {isVerifying && t("importHost.verifying")}
                {isComplete && t("importHost.verifiedWithLabel", { label: importedLabel })}
                {step === "error" && error}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-divider bg-background/30 px-5 py-3">
          {isComplete ? (
            <Button onClick={onClose}>{t("importHost.done")}</Button>
          ) : (
            <>
              <Button disabled={isVerifying} variant="ghost" onClick={onClose}>
                {t("importHost.cancel")}
              </Button>
              <Button disabled={isVerifying || offer.trim().length === 0} onClick={handleVerify}>
                <Link2 size={14} />
                {isVerifying ? t("importHost.connecting") : t("importHost.verifyImport")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
