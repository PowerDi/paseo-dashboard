import { LoaderCircle, OctagonX } from "lucide-react";
import type { SessionStatus } from "@/lib/agent-tree";

/**
 * Sidebar run-state glyph. Idle keeps a dot so every row shares one rail;
 * running and error swap in an icon that reads at a glance.
 */
export function SessionStatusMarker({ status, label }: { status: SessionStatus; label: string }) {
  if (status === "running") {
    return (
      <LoaderCircle
        size={12}
        className="shrink-0 animate-spin text-[var(--running)]"
        aria-label={label}
      />
    );
  }
  if (status === "error") {
    return <OctagonX size={12} className="shrink-0 text-[var(--danger)]" aria-label={label} />;
  }
  return (
    <span
      className="dashboard-status-dot"
      aria-label={label}
      style={{ background: "var(--foreground-faint)" }}
    />
  );
}
