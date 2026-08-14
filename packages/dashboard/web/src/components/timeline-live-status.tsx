import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatElapsed } from "@/lib/format-time";
import type { LiveActivity } from "@/lib/live-activity";

/** Ticks once a second so the running counter advances without a global clock. */
function useSecondsTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

export function TimelineLiveStatus({ activity }: { activity: LiveActivity }) {
  const { t } = useTranslation();
  const now = useSecondsTick(activity.startedAt !== undefined);
  const elapsed = activity.startedAt === undefined ? null : formatElapsed(now - activity.startedAt);

  const label =
    activity.phase === "tool" && activity.detail
      ? t("workspace.timeline.runningTool", { detail: activity.detail })
      : t("workspace.timeline.replying");

  return (
    <div className="timeline-live-status" role="status" aria-live="polite">
      <span className="timeline-live-dot" aria-hidden="true" />
      <span className="shimmer-text truncate">{label}</span>
      {elapsed ? <span className="timeline-live-elapsed">{elapsed}</span> : null}
    </div>
  );
}
