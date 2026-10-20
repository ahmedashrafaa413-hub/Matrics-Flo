import { getReportingPeriod, normalizePreset } from "./reportingPeriod.mjs";

// GA4 Data API date range for a MetricsFlo preset. Accepts the shared presets
// (last_7d, last_month, ...) and the legacy GA values the pages still send
// (7daysAgo, 30daysAgo, 90daysAgo). Explicit dates replace GA's relative
// "NdaysAgo → today", which counted N+1 days including today.
export function getGaDateRange(range, { timeZone, now } = {}) {
  const preset = normalizePreset(range, "last_30d");
  const period = getReportingPeriod(preset, { timeZone, now });

  return {
    preset: period.preset,
    startDate: period.from || "2015-08-14",
    endDate: period.to
  };
}
