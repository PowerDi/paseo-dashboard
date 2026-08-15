import { Brain } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatElapsed } from "@/lib/format-time";
import type { LiveActivity } from "@/lib/live-activity";

function useSecondsTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function TimelineLiveStatus({ activity }: { activity: LiveActivity }) {
  const { t } = useTranslation();
  const [mountedAt] = useState(() => Date.now());
  const now = useSecondsTick();
  // A daemon timestamp can be missing or ahead of the browser clock. Keep the
  // counter live in both cases instead of clamping it at 0s forever.
  const startedAt =
    activity.startedAt !== undefined && activity.startedAt <= mountedAt + 1_000
      ? activity.startedAt
      : mountedAt;
  const elapsed = formatElapsed(now - startedAt);

  return (
    <div
      className="timeline-live-status"
      role="status"
      aria-label={t("workspace.timeline.thinking")}
    >
      <Brain className="timeline-live-spinner" size={15} strokeWidth={1.75} aria-hidden="true" />
      {elapsed ? <span className="timeline-live-elapsed">{elapsed}</span> : null}
    </div>
  );
}
