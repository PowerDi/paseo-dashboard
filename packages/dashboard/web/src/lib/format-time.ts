const RELATIVE_STEPS: { limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60_000, divisor: 1_000, unit: "second" },
  { limit: 3_600_000, divisor: 60_000, unit: "minute" },
  { limit: 86_400_000, divisor: 3_600_000, unit: "hour" },
  { limit: 30 * 86_400_000, divisor: 86_400_000, unit: "day" },
  { limit: 365 * 86_400_000, divisor: 30 * 86_400_000, unit: "month" },
  { limit: Number.POSITIVE_INFINITY, divisor: 365 * 86_400_000, unit: "year" },
];

export function formatRelativeTime(iso: string, locale: string, now = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;

  const elapsed = now - timestamp;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const step of RELATIVE_STEPS) {
    if (Math.abs(elapsed) < step.limit) {
      return formatter.format(Math.round(-elapsed / step.divisor), step.unit);
    }
  }
  return iso;
}

/** Compact running-turn counter: "8s", "1:04", "1:02:03". */
export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (totalSeconds < 60) return `${seconds}s`;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours === 0) return `${minutes}:${paddedSeconds}`;
  return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
}

export function formatDateTime(iso: string, locale: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}
