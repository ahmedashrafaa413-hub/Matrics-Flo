import { NextResponse } from "next/server";
import { safeNumber, safeDivide, toSAR } from "../../../../lib/currency";

export const dynamic = "force-dynamic";

function getBaseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function getCookieHeader(request) {
  return request.headers.get("cookie") || "";
}

async function fetchJson(url, request) {
  try {
    const cookieHeader = getCookieHeader(request);

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      }
    });

    const text = await response.text();

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      return {
        success: false,
        error: `Invalid JSON response from ${url}. Response starts with: ${text.slice(
          0,
          120
        )}`,
        status: response.status,
        data: null
      };
    }

    if (!response.ok || data?.success === false) {
      return {
        success: false,
        error:
          data?.error?.message ||
          data?.error ||
          `Request failed: ${response.status}`,
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
  spendCurrency = "SAR",
  clicks = 0,
  purchases = 0,
  sales = 0,
  salesCurrency = "SAR",
  impressions = 0
}) {
  const spendOriginal = safeNumber(spend);
  const salesOriginal = safeNumber(sales);

  const spendSAR = toSAR(spendOriginal, spendCurrency);
  const salesSAR = toSAR(salesOriginal, salesCurrency);

  const normalizedClicks = safeNumber(clicks);
  const normalizedPurchases = safeNumber(purchases);

  return {
    source,
    type,
    currency: "SAR",

    spend: spendSAR,
    spend_original: spendOriginal,
    spend_currency: spendCurrency,

    clicks: normalizedClicks,
    impressions: safeNumber(impressions),
    purchases: normalizedPurchases,

    cost_per_purchase: safeDivide(spendSAR, normalizedPurchases),

    sales: salesSAR,
    sales_original: salesOriginal,
    sales_currency: salesCurrency,

    roas: safeDivide(salesSAR, spendSAR)
  };
}

function buildSummary(sources) {
  const rowsWithoutTotal = sources.filter((row) => row.source !== "Total");

  const totalSales = rowsWithoutTotal.reduce(
    (sum, row) => sum + safeNumber(row.sales),
    0
  );

  const totalAdsSpend = rowsWithoutTotal
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.spend), 0);

  const totalAdsSales = rowsWithoutTotal
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const totalOrganicSales = rowsWithoutTotal
    .filter((row) => row.type === "organic")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const totalOtherSales = rowsWithoutTotal
    .filter((row) => row.type === "other")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const totalPurchases = rowsWithoutTotal.reduce(
    (sum, row) => sum + safeNumber(row.purchases),
    0
  );

  const totalClicks = rowsWithoutTotal.reduce(
    (sum, row) => sum + safeNumber(row.clicks),
    0
  );

  return {
    currency: "SAR",
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

function getMetaSummary(metaResult) {
  return metaResult.data?.summary || metaResult.data?.data?.[0] || {};
}

function getSnapchatSummary(snapResult) {
  return snapResult.data?.summary || {};
}

function getSallaSummary(sallaResult) {
  return sallaResult.data?.summary || sallaResult.data || {};
}

function getSelectedAccountCurrency(accountId, source, fallback) {
  const found = source.find((account) => account.id === accountId);
  return found?.currency || found?.account_currency || fallback;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const baseUrl = getBaseUrl(request);

  const datePreset = searchParams.get("date_preset") || "last_30d";

  const metaAccountId = searchParams.get("meta_account_id") || "";
  const snapchatAccountId = searchParams.get("snapchat_account_id") || "";

  let metaCurrency = searchParams.get("meta_currency") || "USD";
  let snapchatCurrency = searchParams.get("snapchat_currency") || "USD";
  const sallaCurrency = searchParams.get("salla_currency") || "SAR";

  const sources = [];
  const debug = [];

  const metaAccountsResult = await fetchJson(
    `${baseUrl}/api/meta/accounts`,
    request
  );

  const metaAccounts = Array.isArray(metaAccountsResult.data?.data)
    ? metaAccountsResult.data.data
    : [];

  if (metaAccountId) {
    metaCurrency = getSelectedAccountCurrency(
      metaAccountId,
      metaAccounts,
      metaCurrency
    );
  }

  const snapAccountsResult = await fetchJson(
    `${baseUrl}/api/snapchat/accounts`,
    request
  );

  const snapAccounts = Array.isArray(snapAccountsResult.data?.data)
    ? snapAccountsResult.data.data
    : [];

  if (snapchatAccountId) {
    snapchatCurrency = getSelectedAccountCurrency(
      snapchatAccountId,
      snapAccounts,
      snapchatCurrency
    );
  }

  if (metaAccountId) {
    const metaUrl =
      `${baseUrl}/api/meta/insights` +
      `?account_id=${encodeURIComponent(metaAccountId)}` +
      `&level=account` +
      `&date_preset=${encodeURIComponent(datePreset)}`;

    const metaResult = await fetchJson(metaUrl, request);

    debug.push({
      source: "Meta Ads",
      success: metaResult.success,
      error: metaResult.error || null,
      assumed_currency: metaCurrency
    });

    const summary = getMetaSummary(metaResult);

    sources.push(
      normalizeSource({
        source: "Meta Ads",
        type: "ads",
        spend: summary.spend,
        spendCurrency:
          summary.currency || summary.account_currency || metaCurrency,
        clicks: summary.clicks || summary.inline_link_clicks,
        impressions: summary.impressions,
        purchases: summary.purchases,
        sales: summary.purchase_value || summary.revenue,
        salesCurrency:
          summary.currency || summary.account_currency || metaCurrency
      })
    );
  } else {
    debug.push({
      source: "Meta Ads",
      success: false,
      error: "No Meta account selected",
      assumed_currency: metaCurrency
    });

    sources.push(
      normalizeSource({
        source: "Meta Ads",
        type: "ads",
        spendCurrency: metaCurrency,
        salesCurrency: metaCurrency
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

    const snapResult = await fetchJson(snapUrl, request);

    debug.push({
      source: "Snapchat Ads",
      success: snapResult.success,
      error: snapResult.error || null,
      partial_data: snapResult.data?.partial_data || false,
      rate_limited: snapResult.data?.rate_limited || false,
      assumed_currency: snapchatCurrency
    });

    const summary = getSnapchatSummary(snapResult);

    sources.push(
      normalizeSource({
        source: "Snapchat Ads",
        type: "ads",
        spend: summary.spend,
        spendCurrency:
          summary.currency || summary.account_currency || snapchatCurrency,
        clicks: summary.swipes || summary.clicks,
        impressions: summary.impressions,
        purchases: summary.purchases,
        sales: summary.revenue || summary.purchase_value,
        salesCurrency:
          summary.currency || summary.account_currency || snapchatCurrency
      })
    );
  } else {
    debug.push({
      source: "Snapchat Ads",
      success: false,
      error: "No Snapchat account selected",
      assumed_currency: snapchatCurrency
    });

    sources.push(
      normalizeSource({
        source: "Snapchat Ads",
        type: "ads",
        spendCurrency: snapchatCurrency,
        salesCurrency: snapchatCurrency
      })
    );
  }

  const sallaUrl =
    `${baseUrl}/api/salla/summary` +
    `?date_preset=${encodeURIComponent(datePreset)}`;

  const sallaResult = await fetchJson(sallaUrl, request);

  debug.push({
    source: "Salla",
    success: sallaResult.success,
    error: sallaResult.error || null,
    assumed_currency: sallaCurrency
  });

  const sallaSummary = getSallaSummary(sallaResult);

  const sallaTotalSales =
    safeNumber(sallaSummary.total_sales) ||
    safeNumber(sallaSummary.sales) ||
    safeNumber(sallaSummary.revenue);

  const sallaOrders =
    safeNumber(sallaSummary.total_orders) ||
    safeNumber(sallaSummary.orders) ||
    safeNumber(sallaSummary.purchases);

  const sallaSalesSAR = toSAR(sallaTotalSales, sallaCurrency);

  const adsSalesSAR = sources
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const adsPurchases = sources
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.purchases), 0);

  const organicSalesSAR = Math.max(sallaSalesSAR - adsSalesSAR, 0);
  const organicOrders = Math.max(sallaOrders - adsPurchases, 0);

  sources.push(
    normalizeSource({
      source: "Salla Organic / Other",
      type: "organic",
      spend: 0,
      spendCurrency: "SAR",
      clicks: 0,
      purchases: organicOrders,
      sales: organicSalesSAR,
      salesCurrency: "SAR"
    })
  );

  const totalAdsSpendSAR = sources
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.spend), 0);

  const totalClicks = sources.reduce(
    (sum, row) => sum + safeNumber(row.clicks),
    0
  );

  const totalPurchases = sources.reduce(
    (sum, row) => sum + safeNumber(row.purchases),
    0
  );

  const totalSalesSAR =
    sallaSalesSAR ||
    sources.reduce((sum, row) => sum + safeNumber(row.sales), 0);

  const totalRow = normalizeSource({
    source: "Total",
    type: "total",
    spend: totalAdsSpendSAR,
    spendCurrency: "SAR",
    clicks: totalClicks,
    purchases: totalPurchases,
    sales: totalSalesSAR,
    salesCurrency: "SAR"
  });

  const rows = [...sources, totalRow];

  return NextResponse.json({
    success: true,
    version: "performance-overview-v3-cookie-forwarding-sar",
    base_currency: "SAR",
    date_preset: datePreset,
    exchange_rates: {
      USD_SAR: 3.75
    },
    summary: buildSummary(rows),
    sources: rows,
    debug,
    note:
      "All internal API requests now forward the user cookies. All spend, sales, CPA, CPC and ROAS are normalized to SAR. Actual ROAS = Salla real sales in SAR / total ad spend in SAR."
  });
}
