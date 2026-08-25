const LOWER_IS_BETTER = new Set(["cpa", "cpc", "cpm"]);

export function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function safeRatio(numerator, denominator, multiplier = 1) {
  const top = nullableNumber(numerator);
  const bottom = nullableNumber(denominator);
  return top === null || bottom === null || bottom === 0 ? null : (top / bottom) * multiplier;
}

export function compareMetric(key, currentValue, previousValue) {
  const current = nullableNumber(currentValue);
  const previous = nullableNumber(previousValue);
  const absolute = current === null || previous === null ? null : current - previous;
  const percent = previous === null || previous === 0 || absolute === null
    ? null
    : (absolute / Math.abs(previous)) * 100;
  const rawDirection = absolute === null || absolute === 0 ? "neutral" : absolute > 0 ? "up" : "down";
  const improved = rawDirection === "neutral"
    ? null
    : LOWER_IS_BETTER.has(key) ? rawDirection === "down" : rawDirection === "up";
  return { key, current, previous, absolute, percent, direction: rawDirection, improved };
}

export function normalizeCampaign(row, platform) {
  const spend = nullableNumber(row?.spend);
  const revenue = nullableNumber(row?.purchase_value ?? row?.revenue);
  const purchases = nullableNumber(row?.purchases);
  const impressions = nullableNumber(row?.impressions);
  const clicks = nullableNumber(row?.clicks ?? row?.swipes);
  return {
    platform,
    id: String(row?.campaign_id || row?.entity_id || ""),
    name: String(row?.campaign_name || row?.entity_name || ""),
    status: row?.status || row?.effective_status || row?.raw?.status || null,
    currency: row?.currency || null,
    spend,
    revenue,
    purchases,
    impressions,
    clicks,
    roas: nullableNumber(row?.roas) ?? safeRatio(revenue, spend),
    cpa: nullableNumber(row?.cpa) ?? safeRatio(spend, purchases),
    ctr: nullableNumber(row?.ctr) ?? safeRatio(clicks, impressions, 100),
    cpc: nullableNumber(row?.cpc) ?? safeRatio(spend, clicks),
    cpm: nullableNumber(row?.cpm) ?? safeRatio(spend, impressions, 1000),
    landing_page_views: nullableNumber(row?.landing_page_views),
    add_to_cart: nullableNumber(row?.add_to_cart),
    checkout: nullableNumber(row?.initiate_checkout),
    data_status: spend === null ? "incomplete" : "available"
  };
}

export function detectDataQuality({ sources = [], campaigns = [], freshness = {} }) {
  const issues = [];
  for (const source of sources) {
    if (source.connected && source.success === false) {
      issues.push({ code: "source_unavailable", severity: "high", source: source.source, confidence: "high" });
    }
  }
  for (const campaign of campaigns) {
    if ((campaign.spend || 0) > 0 && campaign.impressions === 0) {
      issues.push({ code: "spend_without_impressions", severity: "critical", source: campaign.platform, entity: campaign.name, confidence: "high" });
    }
    if ((campaign.purchases || 0) > 0 && campaign.revenue === 0) {
      issues.push({ code: "purchases_without_revenue", severity: "high", source: campaign.platform, entity: campaign.name, confidence: "high" });
    }
  }
  if (freshness.snapchatConnected && !freshness.snapchatLastSyncedAt) {
    issues.push({ code: "stale_snapchat", severity: "high", source: "Snapchat Ads", confidence: "high" });
  }
  return issues.slice(0, 20);
}

export function buildAnalyticsSnapshot({ current = {}, previous = {}, campaigns = [], sources = [], freshness = {} }) {
  const metricMap = {
    spend: [current.total_ads_spend, previous.total_ads_spend],
    revenue: [current.total_sales, previous.total_sales],
    purchases: [current.total_purchases, previous.total_purchases],
    roas: [current.actual_roas, previous.actual_roas],
    cpa: [current.cost_per_purchase, previous.cost_per_purchase]
  };
  const comparisons = Object.fromEntries(
    Object.entries(metricMap).map(([key, values]) => [key, compareMetric(key, values[0], values[1])])
  );
  return {
    comparisons,
    campaigns,
    data_quality: detectDataQuality({ sources, campaigns, freshness }),
    generated_at: new Date().toISOString()
  };
}
