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

export function formatDateTime(iso: string, locale: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}
