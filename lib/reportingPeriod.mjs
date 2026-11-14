// One definition of every date preset, shared by Meta, Snapchat, GA4 and
// Salla so the same label means the same days on every platform.
//
// The convention matches Meta Ads Manager and the GA4 UI:
//   today / yesterday       a single calendar day
//   last_7d / 30d / 90d     the N complete days ending yesterday (no today)
//   this_month              the 1st of this month through today
//   last_month              the whole previous calendar month
//   maximum                 no lower bound (callers may cap it)
//
// Days are calendar days in `timeZone` (the ad account's or workspace's
// timezone). `from` and `to` are inclusive YYYY-MM-DD dates; the timestamps
// are midnights in that zone, with `toExclusiveTimestamp` the midnight after
// `to`.

export const DEFAULT_TIME_ZONE = "Asia/Riyadh";

export const REPORTING_PRESETS = Object.freeze([
  "today",
  "yesterday",
  "last_7d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
  "maximum"
]);

// Legacy GA4 relative values still sent by older pages.
const PRESET_ALIASES = Object.freeze({
  "7daysAgo": "last_7d",
  "30daysAgo": "last_30d",
  "90daysAgo": "last_90d"
});

export function normalizePreset(preset, fallback = "last_30d") {
  const value = PRESET_ALIASES[preset] || preset;
  return REPORTING_PRESETS.includes(value) ? value : fallback;
}

export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function safeTimeZone(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

function calendarDate(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );

  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

function fromParts({ y, m, d }) {
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

export function shiftDate(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

// "+03:00" for Asia/Riyadh, "-04:00" for New York in summer, "+00:00" for UTC.
export function zoneOffset(dateString, timeZone = DEFAULT_TIME_ZONE) {
  const zone = safeTimeZone(timeZone);
  const noon = new Date(`${dateString}T12:00:00Z`);
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(noon)
      .find((part) => part.type === "timeZoneName")?.value || "GMT";

  const match = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return "+00:00";

  const [, sign, hours, minutes = "00"] = match;
  return `${sign}${hours.padStart(2, "0")}:${minutes}`;
}

export function zonedMidnight(dateString, timeZone = DEFAULT_TIME_ZONE) {
  return `${dateString}T00:00:00${zoneOffset(dateString, timeZone)}`;
}

export function getReportingPeriod(
  preset = "last_30d",
  { timeZone = DEFAULT_TIME_ZONE, now = new Date() } = {}
) {
  const zone = safeTimeZone(timeZone);
  const normalized = normalizePreset(preset);
  const todayParts = calendarDate(now, zone);
  const today = toDateString(fromParts(todayParts));
  const yesterday = shiftDate(today, -1);
  const monthStart = toDateString(fromParts({ ...todayParts, d: 1 }));

  let from;
  let to;

  switch (normalized) {
    case "today":
      from = today;
      to = today;
      break;
    case "yesterday":
      from = yesterday;
      to = yesterday;
      break;
    case "last_7d":
      from = shiftDate(today, -7);
      to = yesterday;
      break;
    case "last_90d":
      from = shiftDate(today, -90);
      to = yesterday;
      break;
    case "this_month":
      from = monthStart;
      to = today;
      break;
    case "last_month":
      to = shiftDate(monthStart, -1);
      from = `${to.slice(0, 8)}01`;
      break;
    case "maximum":
      from = null;
      to = today;
      break;
    case "last_30d":
    default:
      from = shiftDate(today, -30);
      to = yesterday;
      break;
  }

  const toExclusive = shiftDate(to, 1);

  return {
    preset: normalized,
    timeZone: zone,
    from,
    to,
    toExclusive,
    includesToday: to === today,
    fromTimestamp: from ? zonedMidnight(from, zone) : null,
    toExclusiveTimestamp: zonedMidnight(toExclusive, zone)
  };
}
