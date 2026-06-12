import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeDivide(a, b) {
  const x = safeNumber(a);
  const y = safeNumber(b);

  if (!y) return 0;

  return x / y;
}

function getBaseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store"
    });

    const text = await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: "Invalid JSON response",
        status: response.status,
        data: null
      };
    }

    if (!response.ok || data?.success === false) {
      return {
        success: false,
        error: data?.error || `Request failed: ${response.status}`,
        status: response.status,
        data
      };
    }

    return {
      success: true,
      data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
}

function normalizeSource({
  source,
  type = "ads",
  spend = 0,
  clicks = 0,
  purchases = 0,
  sales = 0,
  impressions = 0
}) {
  const normalizedSpend = safeNumber(spend);
  const normalizedClicks = safeNumber(clicks);
  const normalizedPurchases = safeNumber(purchases);
  const normalizedSales = safeNumber(sales);

  return {
    source,
    type,
    spend: normalizedSpend,
    clicks: normalizedClicks,
    impressions: safeNumber(impressions),
    purchases: normalizedPurchases,
    cost_per_purchase: safeDivide(normalizedSpend, normalizedPurchases),
    sales: normalizedSales,
    roas: safeDivide(normalizedSales, normalizedSpend)
  };
}

function buildSummary(sources) {
  const totalSales = sources.reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const totalAdsSpend = sources
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.spend), 0);

  const totalAdsSales = sources
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const totalOrganicSales = sources
    .filter((row) => row.type === "organic")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const totalOtherSales = sources
    .filter((row) => row.type === "other")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const totalPurchases = sources.reduce(
    (sum, row) => sum + safeNumber(row.purchases),
    0
  );

  const totalClicks = sources.reduce((sum, row) => sum + safeNumber(row.clicks), 0);

  return {
    total_sales: totalSales,
    total_ads_sales: totalAdsSales,
    total_organic_sales: totalOrganicSales,
    total_other_sales: totalOtherSales,
    total_ads_spend: totalAdsSpend,
    total_purchases: totalPurchases,
    total_clicks: totalClicks,
    actual_roas: safeDivide(totalSales, totalAdsSpend),
    ads_roas: safeDivide(totalAdsSales, totalAdsSpend),
    cost_per_purchase: safeDivide(totalAdsSpend, totalPurchases)
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const baseUrl = getBaseUrl(request);

  const datePreset = searchParams.get("date_preset") || "last_30d";

  const metaAccountId = searchParams.get("meta_account_id") || "";
  const snapchatAccountId = searchParams.get("snapchat_account_id") || "";

  const sources = [];
  const debug = [];

  if (metaAccountId) {
    const metaUrl =
      `${baseUrl}/api/meta/insights` +
      `?account_id=${encodeURIComponent(metaAccountId)}` +
      `&level=account` +
      `&date_preset=${encodeURIComponent(datePreset)}`;

    const metaResult = await fetchJson(metaUrl);

    debug.push({
      source: "Meta Ads",
      success: metaResult.success,
      error: metaResult.error || null
    });

    const summary = metaResult.data?.summary || metaResult.data?.data?.[0] || {};

    sources.push(
      normalizeSource({
        source: "Meta Ads",
        type: "ads",
        spend: summary.spend,
        clicks: summary.clicks || summary.inline_link_clicks,
        impressions: summary.impressions,
        purchases: summary.purchases,
        sales: summary.purchase_value || summary.revenue
      })
    );
  } else {
    sources.push(
      normalizeSource({
        source: "Meta Ads",
        type: "ads"
      })
    );
  }

  if (snapchatAccountId) {
    const snapUrl =
      `${baseUrl}/api/snapchat/insights` +
      `?account_id=${encodeURIComponent(snapchatAccountId)}` +
      `&level=campaign` +
      `&date_preset=${encodeURIComponent(datePreset)}` +
      `&limit=20`;

    const snapResult = await fetchJson(snapUrl);

    debug.push({
      source: "Snapchat Ads",
      success: snapResult.success,
      error: snapResult.error || null,
      partial_data: snapResult.data?.partial_data || false,
      rate_limited: snapResult.data?.rate_limited || false
    });

    const summary = snapResult.data?.summary || {};

    sources.push(
      normalizeSource({
        source: "Snapchat Ads",
        type: "ads",
        spend: summary.spend,
        clicks: summary.swipes || summary.clicks,
        impressions: summary.impressions,
        purchases: summary.purchases,
        sales: summary.revenue || summary.purchase_value
      })
    );
  } else {
    sources.push(
      normalizeSource({
        source: "Snapchat Ads",
        type: "ads"
      })
    );
  }

  const sallaUrl = `${baseUrl}/api/salla/summary?date_preset=${encodeURIComponent(
    datePreset
  )}`;

  const sallaResult = await fetchJson(sallaUrl);

  debug.push({
    source: "Salla",
    success: sallaResult.success,
    error: sallaResult.error || null
  });

  const sallaSummary = sallaResult.data?.summary || sallaResult.data || {};

  const sallaTotalSales =
    safeNumber(sallaSummary.total_sales) ||
    safeNumber(sallaSummary.sales) ||
    safeNumber(sallaSummary.revenue);

  const sallaOrders =
    safeNumber(sallaSummary.total_orders) ||
    safeNumber(sallaSummary.orders) ||
    safeNumber(sallaSummary.purchases);

  const adsSalesFromPlatforms = sources
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const organicSales = Math.max(sallaTotalSales - adsSalesFromPlatforms, 0);

  sources.push(
    normalizeSource({
      source: "Salla Organic / Other",
      type: "organic",
      spend: 0,
      clicks: 0,
      purchases: Math.max(sallaOrders - sources.reduce((s, r) => s + r.purchases, 0), 0),
      sales: organicSales
    })
  );

  const totalRow = normalizeSource({
    source: "Total",
    type: "total",
    spend: sources
      .filter((row) => row.type === "ads")
      .reduce((sum, row) => sum + safeNumber(row.spend), 0),
    clicks: sources.reduce((sum, row) => sum + safeNumber(row.clicks), 0),
    purchases: sources.reduce((sum, row) => sum + safeNumber(row.purchases), 0),
    sales: sallaTotalSales || sources.reduce((sum, row) => sum + safeNumber(row.sales), 0)
  });

  const rows = [...sources, totalRow];

  return NextResponse.json({
    success: true,
    version: "performance-overview-v1",
    date_preset: datePreset,
    summary: buildSummary(rows.filter((row) => row.source !== "Total")),
    sources: rows,
    debug,
    note:
      "Actual ROAS is calculated from Salla real sales divided by total ads spend. Platform sales are used when Salla attribution by source is not available yet."
  });
}
