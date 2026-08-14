import type { AuditEvent } from "@getpaseo/dashboard-shared";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAuditEvents } from "@/api/dashboardApi";
import { SectionLabel } from "@/components/section-label";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format-time";
import { revealDelay, useReveal } from "@/lib/use-reveal";

const PAGE_SIZE = 50;

function eventLabel(type: string, t: (key: string) => string): string {
  const key = `audit.events.${type}`;
  const translated = t(key);
  return translated === key ? type : translated;
}

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useReveal([events.length]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listAuditEvents(undefined, PAGE_SIZE);
      setEvents(response.events);
      setNextCursor(response.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await listAuditEvents(nextCursor, PAGE_SIZE);
      setEvents((prev) => [...prev, ...response.events]);
      setNextCursor(response.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <header className="dashboard-screen-header">
        <h1 className="dashboard-screen-title">{t("audit.title")}</h1>
        <span className="dashboard-screen-subtitle">{t("audit.subtitle")}</span>
      </header>
      <div className="dashboard-screen-body">
        <div className="dashboard-page-column">
          <SectionLabel style={revealDelay(0)}>{t("audit.eventsLabel")}</SectionLabel>
          <p className="dashboard-section-hint mb-3" data-reveal="" style={revealDelay(0)}>
            {t("audit.hint")}
          </p>
          {loading && (
            <div className="py-6 text-center" data-reveal="" style={revealDelay(1)}>
              <LoaderCircle
                className="mx-auto animate-spin text-[var(--foreground-faint)]"
                size={18}
              />
            </div>
          )}
          {error && !loading && (
            <p
              className="py-6 text-center text-[13px] text-[var(--danger)]"
              data-reveal=""
              style={revealDelay(1)}
            >
              {error}
            </p>
          )}
          {!loading && !error && events.length === 0 && (
            <p
              className="py-6 text-center text-[13px] text-[var(--foreground-faint)]"
              data-reveal=""
              style={revealDelay(1)}
            >
              {t("audit.empty")}
            </p>
          )}
          {!loading && events.length > 0 && (
            <div data-reveal="" style={revealDelay(1)}>
              {events.map((event) => (
                <div key={event.id} className="dashboard-list-row group">
                  <div className="dashboard-row-copy">
                    <span className="dashboard-row-title">
                      {eventLabel(event.type, (key) => t(key as never))}
                    </span>
                    <span className="dashboard-row-description">
                      {event.targetType} · {event.targetId}
                    </span>
                  </div>
                  <span className="shrink-0 text-[13px] text-[var(--foreground-faint)]">
                    {formatRelativeTime(event.createdAt, i18n.language)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {nextCursor && (
            <div className="mt-4 flex justify-center" data-reveal="" style={revealDelay(2)}>
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore && <LoaderCircle className="animate-spin" size={14} />}
                {t("audit.loadMore")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
