// Day-by-day Snapchat stats (granularity=DAY) for the MCP connector, so a
// budget or bid edit from get_snapchat_change_history can be lined up with
// the days before and after it. Pure helpers, kept apart from the API client
// so they can be unit tested.

// Snapchat answers DAY requests for at most 32 days; keep a margin.
export const MAX_DAILY_RANGE_DAYS = 31;

const num = (v) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Number(num(v).toFixed(2));
const ratio = (a, b) => (num(b) ? num(a) / num(b) : 0);

// Every core field is a plain count or a micro amount, so day values add up
// to the range total. Reach and frequency do not, which is why daily mode
// asks for the core fields only.
export function parseTimeseries(data) {
  const series =
    data?.timeseries_stats?.[0]?.timeseries_stat?.timeseries ||
    data?.timeseries_stat?.timeseries ||
    [];
  const totals = {};
  const days = [];
  for (const point of series) {
    const stats = point?.stats || {};
    for (const [key, value] of Object.entries(stats)) {
      totals[key] = num(totals[key]) + num(value);
    }
    days.push({ start_time: point?.start_time || null, stats });
  }
  return { totals, days };
}

// The account's local calendar date of a Snapchat day bucket: start_time
// carries the account offset (e.g. 2026-11-15T00:00:00.000+03:00).
export function bucketDate(startTime) {
  return typeof startTime === "string" && /^\d{4}-\d{2}-\d{2}/.test(startTime) ? startTime.slice(0, 10) : null;
}

export function dailyMetrics(stats = {}) {
  const spend = num(stats.spend) / 1e6;
  const revenue = num(stats.conversion_purchases_value) / 1e6;
  const purchases = num(stats.conversion_purchases);
  const impressions = num(stats.impressions);
  const swipes = num(stats.swipes);
  return {
    spend: round2(spend),
    revenue: round2(revenue),
    purchases,
    add_to_cart: num(stats.conversion_add_cart),
    initiate_checkout: num(stats.conversion_start_checkout),
    impressions,
    swipes,
    roas: round2(ratio(revenue, spend)),
    cpa: round2(ratio(spend, purchases)),
    ctr: round2(ratio(swipes, impressions) * 100),
    cpm: round2(ratio(spend, impressions) * 1000)
  };
}

// One entry per day, oldest first, zero days included so gaps stay visible.
export function dailyRows(days) {
  return days
    .map((d) => ({ date: bucketDate(d.start_time), ...dailyMetrics(d.stats) }))
    .filter((d) => d.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Adds rows' daily arrays into one account-wide day list.
export function sumDaily(rowsDaily) {
  const byDate = new Map();
  for (const days of rowsDaily) {
    for (const day of days || []) {
      const acc = byDate.get(day.date) || { date: day.date, spend: 0, revenue: 0, purchases: 0, add_to_cart: 0, initiate_checkout: 0, impressions: 0, swipes: 0 };
      for (const key of ["spend", "revenue", "purchases", "add_to_cart", "initiate_checkout", "impressions", "swipes"]) acc[key] += num(day[key]);
      byDate.set(day.date, acc);
    }
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      spend: round2(d.spend),
      revenue: round2(d.revenue),
      roas: round2(ratio(d.revenue, d.spend)),
      cpa: round2(ratio(d.spend, d.purchases)),
      ctr: round2(ratio(d.swipes, d.impressions) * 100),
      cpm: round2(ratio(d.spend, d.impressions) * 1000)
    }));
}

// Campaigns whose ad squads the answer did not fully cover, so the caller
// can ask again with campaign_id. A campaign counts when the summed spend of
// its returned children is short of its own spend by more than 1% (and $1).
export function missingParents(parents, childRows, parentKey = "campaign_id") {
  const covered = new Map();
  for (const row of childRows) {
    const key = row[parentKey];
    if (!key) continue;
    covered.set(key, num(covered.get(key)) + num(row.spend));
  }
  return parents
    .map((p) => ({ id: p.id, name: p.name, spend: round2(p.spend), covered_spend: round2(covered.get(p.id)) }))
    .filter((p) => p.spend - p.covered_spend > Math.max(1, p.spend * 0.01))
    .sort((a, b) => b.spend - b.covered_spend - (a.spend - a.covered_spend));
}

// DAY stats need day-boundary timestamps. Preset ranges end at the current
// hour (e.g. ...T23:00:00.000+03:00), so a daily request moves that end to
// the next local midnight, the same exclusive boundary the "today" preset
// already uses for the running day.
export function alignEndToDay(endTime) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?([+-]\d{2}:\d{2}|Z)$/.exec(endTime || "");
  if (!m) return endTime;
  const [, y, mo, d, h, mi, s, , offset] = m;
  if (h === "00" && mi === "00" && s === "00") return endTime;
  const next = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + 1));
  const pad = (n) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T00:00:00.000${offset}`;
}
