import { NextResponse } from "next/server";
import { safeNumber, safeDivide, toSAR } from "../../../../lib/currency";
import { buildPerformanceSummary } from "../../../../lib/performanceSummary.mjs";

export const dynamic = "force-dynamic";

function getBaseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function getCookieHeader(request) {
  return request.headers.get("cookie") || "";
}

async function fetchJson(url, request, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const cookieHeader = getCookieHeader(request);

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      },
      signal: controller.signal
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
      error:
        error?.name === "AbortError"
          ? "انتهت مهلة تحميل المصدر"
          : error.message,
      data: null
    };
  } finally {
    clearTimeout(timeout);
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
  impressions = 0,
  available = true
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
    available,
    status: available ? "available" : "unavailable",
    currency: "SAR",

    spend: available ? spendSAR : null,
    spend_original: available ? spendOriginal : null,
    spend_currency: spendCurrency,

    clicks: available ? normalizedClicks : null,
    impressions: available ? safeNumber(impressions) : null,
    purchases: available ? normalizedPurchases : null,

    cost_per_purchase: available ? safeDivide(spendSAR, normalizedPurchases) : null,

    sales: available ? salesSAR : null,
    sales_original: available ? salesOriginal : null,
    sales_currency: salesCurrency,

    roas: available ? safeDivide(salesSAR, spendSAR) : null
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
  const tiktokAccountId = searchParams.get("tiktok_account_id") || "";

  let metaCurrency = searchParams.get("meta_currency") || "USD";
  let snapchatCurrency = searchParams.get("snapchat_currency") || "USD";
  let tiktokCurrency = searchParams.get("tiktok_currency") || "SAR";
  const sallaCurrency = searchParams.get("salla_currency") || "SAR";

  const sources = [];
  const debug = [];

  const [metaAccountsResult, snapAccountsResult, tiktokAccountsResult] = await Promise.all([
    fetchJson(`${baseUrl}/api/meta/accounts`, request),
    fetchJson(`${baseUrl}/api/snapchat/accounts`, request),
    fetchJson(`${baseUrl}/api/connections/status`, request)
  ]);

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

  const tiktokAccounts = tiktokAccountsResult.data?.providers?.tiktok?.accounts || [];
  if (tiktokAccountId) tiktokCurrency = getSelectedAccountCurrency(tiktokAccountId, tiktokAccounts, tiktokCurrency);

  const metaPromise = metaAccountId
    ? fetchJson(
        `${baseUrl}/api/meta/insights` +
          `?account_id=${encodeURIComponent(metaAccountId)}` +
          `&level=account` +
          `&date_preset=${encodeURIComponent(datePreset)}`,
        request
      )
    : Promise.resolve({ success: false, error: "لم يتم اختيار حساب Meta", data: null });

  const snapPromise = snapchatAccountId
    ? fetchJson(
        `${baseUrl}/api/snapchat/data` +
          `?account_id=${encodeURIComponent(snapchatAccountId)}` +
          `&level=account` +
          `&date_preset=${encodeURIComponent(datePreset)}`,
        request
      )
    : Promise.resolve({ success: false, error: "لم يتم اختيار حساب Snapchat", data: null });

  const sallaPromise = fetchJson(
    `${baseUrl}/api/salla/summary?date_preset=${encodeURIComponent(datePreset)}`,
    request
  );
  const tiktokPromise = tiktokAccountId
    ? fetchJson(`${baseUrl}/api/tiktok/data?account_id=${encodeURIComponent(tiktokAccountId)}&level=account&date_preset=${encodeURIComponent(datePreset)}`, request)
    : Promise.resolve({ success:false, error:"No TikTok account selected", data:null });

  const [metaResult, snapResult, sallaResult, tiktokResult] = await Promise.all([
    metaPromise,
    snapPromise,
    sallaPromise,
    tiktokPromise
  ]);

  if (metaAccountId) {

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
        available: metaResult.success,
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
        available: false,
        spendCurrency: metaCurrency,
        salesCurrency: metaCurrency
      })
    );
  }

  if (tiktokAccountId) {
    const summary = tiktokResult.data?.summary || {};
    debug.push({ source:"TikTok Ads", success:tiktokResult.success, error:tiktokResult.error || null, assumed_currency:tiktokCurrency });
    sources.push(normalizeSource({ source:"TikTok Ads", type:"ads", available:tiktokResult.success,
      spend:summary.spend, spendCurrency:summary.currency || tiktokCurrency, clicks:summary.clicks,
      impressions:summary.impressions, purchases:summary.purchases, sales:summary.purchase_value,
      salesCurrency:summary.currency || tiktokCurrency }));
  } else {
    sources.push(normalizeSource({ source:"TikTok Ads", type:"ads", available:false, spendCurrency:tiktokCurrency, salesCurrency:tiktokCurrency }));
  }

  if (snapchatAccountId) {
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
        available: snapResult.success && !snapResult.data?.partial_data,
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
        available: false,
        spendCurrency: snapchatCurrency,
        salesCurrency: snapchatCurrency
      })
    );
  }

  debug.push({
    source: "Salla",
    success: sallaResult.success,
    error: sallaResult.error || null,
    assumed_currency: sallaCurrency
  });

  const sallaSummary = getSallaSummary(sallaResult);

  // /api/salla/summary returns total_revenue; the older names are kept as
  // fallbacks so a cached or legacy response still reads.
  const sallaTotalSales =
    safeNumber(sallaSummary.total_revenue) ||
    safeNumber(sallaSummary.total_sales) ||
    safeNumber(sallaSummary.sales) ||
    safeNumber(sallaSummary.revenue);

  const sallaOrders =
    safeNumber(sallaSummary.total_orders) ||
    safeNumber(sallaSummary.orders) ||
    safeNumber(sallaSummary.purchases);

  const sallaSalesSAR = toSAR(sallaTotalSales, sallaCurrency);

  // Store revenue and ad-platform attributed revenue are distinct measures.
  // Never infer organic sales by subtracting attribution totals from store sales.
  sources.push(
    normalizeSource({
      source: "Salla Store Revenue",
      type: "store",
      available: sallaResult.success,
      purchases: sallaOrders,
      sales: sallaTotalSales,
      salesCurrency: sallaCurrency
    })
  );

  const totalAdsSpendSAR = sources
    .filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.spend), 0);

  const totalClicks = sources.filter((row) => row.type === "ads").reduce(
    (sum, row) => sum + safeNumber(row.clicks),
    0
  );

  const totalPurchases = sources.filter((row) => row.type === "ads").reduce(
    (sum, row) => sum + safeNumber(row.purchases),
    0
  );

  const adsRevenueSAR = sources.filter((row) => row.type === "ads")
    .reduce((sum, row) => sum + safeNumber(row.sales), 0);
  const totalRow = normalizeSource({
    source: "Total",
    type: "total",
    available: sallaResult.success && (!metaAccountId || metaResult.success) &&
      (!snapchatAccountId || (snapResult.success && !snapResult.data?.partial_data)) &&
      (!tiktokAccountId || tiktokResult.success),
    spend: totalAdsSpendSAR,
    spendCurrency: "SAR",
    clicks: totalClicks,
    purchases: sallaOrders,
    sales: sallaTotalSales,
    salesCurrency: sallaCurrency
  });

  const rows = [...sources, totalRow];

  return NextResponse.json({
    success: true,
    partial_data: !sallaResult.success || (Boolean(metaAccountId) && !metaResult.success) || (Boolean(snapchatAccountId) && (!snapResult.success || Boolean(snapResult.data?.partial_data))) || (Boolean(tiktokAccountId) && !tiktokResult.success),
    revenue_breakdown: { store_revenue: sallaResult.success ? sallaSalesSAR : null, platform_attributed_revenue_sum: (metaAccountId && !metaResult.success) || (snapchatAccountId && !snapResult.success) || (tiktokAccountId && !tiktokResult.success) ? null : adsRevenueSAR, organic_revenue: null, attribution_note: "Platform attribution cannot be subtracted from store sales to calculate organic revenue." },
    version: "performance-overview-v3-cookie-forwarding-sar",
    base_currency: "SAR",
    date_preset: datePreset,
    exchange_rates: {
      USD_SAR: 3.75
    },
    summary: { ...buildPerformanceSummary(rows, {
      actualSalesAvailable: sallaResult.success,
      actualSales: sallaSalesSAR,
      actualPurchases: sallaOrders
    }), ...(sallaResult.success ? {} : { total_sales: null, total_purchases: null, actual_roas: null, cost_per_purchase: null }), data_status: !sallaResult.success ? "unavailable" : "available" },
    sources: rows,
    debug,
    note: null
  });
}
