const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLATFORMS = new Set(["snapchat", "meta"]);
const LEVELS = new Set(["campaign", "adset"]);

export function validateQueryInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_arguments");
  const allowed = new Set(["account_id", "platform", "level", "date_from", "date_to"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("unsupported_parameter");
  if (typeof input.account_id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.account_id)) throw new Error("invalid_account_id");
  if (!PLATFORMS.has(input.platform)) throw new Error("unsupported_platform");
  if (!LEVELS.has(input.level)) throw new Error("unsupported_level");
  for (const date of [input.date_from, input.date_to]) {
    if (typeof date !== "string" || !ISO_DATE.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("invalid_date");
  }
  if (input.date_from > input.date_to) throw new Error("invalid_date_range");
  const days = Math.round((Date.parse(input.date_to) - Date.parse(input.date_from)) / 86400000) + 1;
  if (days > 31) throw new Error("date_range_too_large");
  return { ...input, days };
}

export function canonicalDailyRows(sourceRows, { timezone = "Asia/Riyadh", today }) {
  if (!Array.isArray(sourceRows)) throw new Error("invalid_source");
  const seen = new Set();
  return sourceRows.map((row) => {
    // A cache snapshot date for a multi-day preset is NOT a daily metric date.
    // Reject these records rather than silently reporting period totals as daily values.
    if (row.raw?.date_preset || row.date_preset) throw new Error("unverified_snapshot_granularity");
    if (row.reporting_granularity !== "daily") throw new Error("unverified_daily_granularity");
    const date = row.date;
    if (!ISO_DATE.test(date || "") || !row.id || !row.name || !row.platform || !row.currency) throw new Error("incomplete_source_row");
    if (row.is_aggregate === true || /^total(?: of \d+ results)?$/i.test(String(row.name).trim())) return null;
    const key = [date, row.platform, row.account_id || "", row.level || "", row.id].join(":");
    if (seen.has(key)) throw new Error("duplicate_entity_day");
    seen.add(key);
    const monetary = (key) => row[key] == null ? null : { amount: row[key], currency: row.currency };
    return {
      date, timezone, is_partial: date >= today, platform: row.platform,
      id: row.id, name: row.name, spend: monetary("spend"), revenue: monetary("revenue"),
      impressions: row.impressions ?? null, clicks: row.clicks ?? null,
      add_to_cart: row.add_to_cart ?? null, checkout_initiated: row.checkout_initiated ?? null,
      purchases: row.purchases ?? null
    };
  }).filter(Boolean);
}
