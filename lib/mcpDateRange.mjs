// Custom date ranges for MCP tools. Dates are calendar days in Asia/Riyadh,
// the timezone MetricsFlo reports in.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 366;

function riyadhToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function toUtcDate(value) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject impossible dates such as 2026-02-31.
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

function addDays(value, days) {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Returns null when neither bound is given, { error } when invalid, or the
// normalized range. Both bounds are inclusive.
export function parseCustomRange(since, until, now = new Date()) {
  if (since === undefined && until === undefined) return null;
  if (typeof since !== "string" || typeof until !== "string") {
    return { error: "since and until must both be given as YYYY-MM-DD" };
  }
  if (!DATE_RE.test(since) || !DATE_RE.test(until) || !toUtcDate(since) || !toUtcDate(until)) {
    return { error: "since and until must be valid dates in YYYY-MM-DD format" };
  }
  if (since > until) return { error: "since must be on or before until" };
  if (since > riyadhToday(now)) return { error: "since cannot be in the future" };

  const days = Math.round((toUtcDate(until) - toUtcDate(since)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return { error: `Date range is limited to ${MAX_RANGE_DAYS} days` };

  return { since, until, days };
}

// Snapchat stats need hour-aligned timestamps; the end is exclusive.
export function snapchatTimeRange({ since, until }) {
  return {
    startTime: `${since}T00:00:00.000+03:00`,
    endTime: `${addDays(until, 1)}T00:00:00.000+03:00`
  };
}
