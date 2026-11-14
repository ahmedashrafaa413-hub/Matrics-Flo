import { getReportingPeriod, zonedMidnight } from "./reportingPeriod.mjs";

// Kept for existing callers. The preset rules now live in
// reportingPeriod.mjs so Salla matches Meta, Snapchat and GA4.
export function getRiyadhDateRange(preset = "last_30d", now = new Date(), timeZone) {
  const period = getReportingPeriod(preset, { now, timeZone });
  const from = period.from || "2000-01-01";

  return {
    preset: period.preset,
    from,
    to: period.to,
    fromTimestamp: period.fromTimestamp || zonedMidnight(from, period.timeZone),
    toExclusiveTimestamp: period.toExclusiveTimestamp
  };
}
