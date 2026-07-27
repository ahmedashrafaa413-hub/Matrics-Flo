import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

const CAMPAIGN_FIELDS = [
  "impressions",
  "spend",
  "swipes",
  "conversion_purchases",
  "conversion_purchases_value",
  "video_views",
  "quartile_1",
  "quartile_2",
  "quartile_3",
  "view_completion",
  "screen_time_millis"
].join(",");

const ACCOUNT_SPEND_ONLY_FIELDS = "spend";

const VALID_SWIPE_WINDOWS = ["1_DAY", "7_DAY", "28_DAY"];

const VALID_VIEW_WINDOWS = [
  "1_HOUR",
  "3_HOUR",
  "6_HOUR",
  "1_DAY",
  "7_DAY",
  "28_DAY"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeNum(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function safeDivide(a, b) {
  const x = safeNum(a);
  const y = safeNum(b);
  return y ? x / y : 0;
}

function micros(value) {
  return safeNum(value) / 1_000_000;
}

function fix2(value) {
  return Number(safeNum(value).toFixed(2));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function getDateRange(preset) {
  const utcNow = new Date();
  const riyadhNow = new Date(utcNow.getTime() + 3 * 3600_000);

  const today = {
    y: riyadhNow.getUTCFullYear(),
    m: riyadhNow.getUTCMonth() + 1,
    d: riyadhNow.getUTCDate(),
    h: riyadhNow.getUTCHours()
  };

  function shiftDay(days) {
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d));
    date.setUTCDate(date.getUTCDate() + days);

    return {
      y: date.getUTCFullYear(),
      m: date.getUTCMonth() + 1,
      d: date.getUTCDate()
    };
  }

  function stamp(day, hour) {
    return `${day.y}-${pad(day.m)}-${pad(day.d)}T${pad(hour)}:00:00.000+03:00`;
  }

  const nowHour = today.h || 1;

  let startDay;
  let endDay;
  let endHour;

  if (preset === "today") {
    startDay = today;
    endDay = today;
    endHour = nowHour;
  } else if (preset === "yesterday") {
    startDay = shiftDay(-1);
    endDay = today;
    endHour = 0;
  } else if (preset === "last_7d") {
    startDay = shiftDay(-6);
    endDay = today;
    endHour = nowHour;
  } else if (preset === "last_30d") {
    startDay = shiftDay(-29);
    endDay = today;
    endHour = nowHour;
  } else if (preset === "last_90d") {
    startDay = shiftDay(-89);
    endDay = today;
    endHour = nowHour;
  } else if (preset === "this_month") {
    startDay = {
      y: today.y,
      m: today.m,
      d: 1
    };
    endDay = today;
    endHour = nowHour;
  } else if (preset === "maximum") {
    startDay = {
      y: 2020,
      m: 1,
      d: 1
    };
    endDay = today;
    endHour = nowHour;
  } else {
    startDay = shiftDay(-29);
    endDay = today;
    endHour = nowHour;
  }

  return {
    startTime: stamp(startDay, 0),
    endTime: stamp(endDay, endHour)
  };
}

async function snapFetch(url, token, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    const text = await response.text();

    if (response.status === 429 && attempt < retries) {
      await sleep(1200 * (attempt + 1));
      continue;
    }

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: response.status,
        data: null,
        error: `Snapchat response is not JSON: ${text.slice(0, 250)}`
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        error:
          data?.debug_message ||
          data?.display_message ||
          data?.request_status ||
          data?.message ||
          `Snapchat request failed with status ${response.status}`
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
      error: null
    };
  }

  return {
    ok: false,
    status: 429,
    data: null,
    error: "Snapchat rate limit after retries"
  };
}

function extractTotalStats(data) {
  if (data?.total_stats?.[0]?.total_stat?.stats) {
    return data.total_stats[0].total_stat.stats;
  }

  if (data?.total_stat?.stats) {
    return data.total_stat.stats;
  }

  if (data?.timeseries_stats?.[0]?.timeseries_stat?.timeseries?.[0]?.stats) {
    return data.timeseries_stats[0].timeseries_stat.timeseries[0].stats;
  }

  if (data?.stats) {
    return data.stats;
  }

  return {};
}

function buildMetrics(stats = {}) {
  const spend = micros(stats.spend);
  const revenue = micros(stats.conversion_purchases_value);
  const purchases = safeNum(stats.conversion_purchases);

  const impressions = safeNum(stats.impressions);
  const swipes = safeNum(stats.swipes);

  const videoViews = safeNum(stats.video_views);
  const quartile1 = safeNum(stats.quartile_1);
  const quartile2 = safeNum(stats.quartile_2);
  const quartile3 = safeNum(stats.quartile_3);
  const viewCompletion = safeNum(stats.view_completion);
  const screenTimeMillis = safeNum(stats.screen_time_millis);

  const effectiveVideoViews = videoViews || quartile1 || viewCompletion || 0;

  return {
    currency: "USD",

    spend: fix2(spend),
    revenue: fix2(revenue),
    purchase_value: fix2(revenue),
    purchases,

    impressions,
    swipes,
    clicks: swipes,

    video_views: effectiveVideoViews,
    quartile_1: quartile1,
    quartile_2: quartile2,
    quartile_3: quartile3,
    view_completion: viewCompletion,
    screen_time_sec: fix2(screenTimeMillis / 1000),

    roas: fix2(safeDivide(revenue, spend)),
    cpa: fix2(safeDivide(spend, purchases)),
    ctr: fix2(safeDivide(swipes, impressions) * 100),
    cpc: fix2(safeDivide(spend, swipes)),
    cpm: fix2(safeDivide(spend, impressions) * 1000),

    hook_rate: fix2(safeDivide(effectiveVideoViews, impressions) * 100),
    hold_rate: fix2(safeDivide(quartile3, quartile1) * 100),
    completion_rate: fix2(safeDivide(viewCompletion, impressions) * 100),
    video_view_rate: fix2(safeDivide(effectiveVideoViews, impressions) * 100)
  };
}

function normalizeStatus(raw) {
  const status = String(raw?.status || raw?.effective_status || "").toUpperCase();

  if (["ACTIVE", "RUNNING", "DELIVERING", "LIVE"].includes(status)) {
    return "ACTIVE";
  }

  if (["PAUSED", "INACTIVE"].includes(status)) {
    return "PAUSED";
  }

  if (["PENDING", "UNDER_REVIEW", "IN_REVIEW"].includes(status)) {
    return "PENDING";
  }

  if (["DELETED", "ARCHIVED"].includes(status)) {
    return status;
  }

  return status || "UNKNOWN";
}

async function fetchAdAccountSpendOnly({
  accountId,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow
}) {
  const url =
    `${BASE}/adaccounts/${encodeURIComponent(accountId)}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(ACCOUNT_SPEND_ONLY_FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${encodeURIComponent(swipeWindow)}` +
    `&view_attribution_window=${encodeURIComponent(viewWindow)}`;

  const result = await snapFetch(url, token);

  if (!result.ok) {
    return {
      success: false,
      status: result.status,
      error: result.error,
      raw: result.data || null,
      spend: 0
    };
  }

  const stats = extractTotalStats(result.data);

  return {
    success: true,
    status: result.status,
    error: null,
    spend: fix2(micros(stats.spend)),
    raw_stats: stats
  };
}

async function fetchCampaigns({ accountId, token }) {
  const campaigns = [];
  let nextUrl = `${BASE}/adaccounts/${encodeURIComponent(accountId)}/campaigns?limit=1000`;
  let pages = 0;

  while (nextUrl && pages < 15) {
    const result = await snapFetch(nextUrl, token);

    if (!result.ok) {
      return {
        success: false,
        status: result.status,
        error: result.error,
        campaigns,
        pages_fetched: pages
      };
    }

    const rawItems = result.data?.campaigns || [];

    for (const item of rawItems) {
      const campaign = item.campaign || item;

      if (!campaign?.id) continue;

      campaigns.push({
        id: campaign.id,
        name: campaign.name || "Unnamed Campaign",
        status: normalizeStatus(campaign),
        raw_status: campaign.status || campaign.effective_status || "",
        updated_at: campaign.updated_at || campaign.created_at || null,
        raw: campaign
      });
    }

    nextUrl = result.data?.paging?.next_link || null;
    pages += 1;
  }

  return {
    success: true,
    campaigns,
    pages_fetched: pages
  };
}

async function fetchCampaignStats({
  campaignId,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow
}) {
  const url =
    `${BASE}/campaigns/${encodeURIComponent(campaignId)}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(CAMPAIGN_FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${encodeURIComponent(swipeWindow)}` +
    `&view_attribution_window=${encodeURIComponent(viewWindow)}`;

  const result = await snapFetch(url, token);

  if (!result.ok) {
    return {
      success: false,
      status: result.status,
      error: result.error,
      stats: {},
      metrics: buildMetrics({})
    };
  }

  const stats = extractTotalStats(result.data);

  return {
    success: true,
    status: result.status,
    error: null,
    stats,
    metrics: buildMetrics(stats)
  };
}

function hasMeaningfulMetrics(metrics) {
  return (
    safeNum(metrics.spend) > 0.001 ||
    safeNum(metrics.revenue) > 0.001 ||
    safeNum(metrics.purchases) > 0 ||
    safeNum(metrics.impressions) > 0 ||
    safeNum(metrics.clicks || metrics.swipes) > 0 ||
    safeNum(metrics.video_views) > 0
  );
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    {
      length: Math.min(limit, items.length)
    },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

function sumMetrics(rows) {
  const total = rows.reduce(
    (acc, row) => {
      const item = row.metrics || row;

      acc.spend += safeNum(item.spend);
      acc.revenue += safeNum(item.revenue);
      acc.purchases += safeNum(item.purchases);
      acc.impressions += safeNum(item.impressions);
      acc.clicks += safeNum(item.clicks || item.swipes);
      acc.video_views += safeNum(item.video_views);

      return acc;
    },
    {
      spend: 0,
      revenue: 0,
      purchases: 0,
      impressions: 0,
      clicks: 0,
      video_views: 0
    }
  );

  return {
    currency: "USD",
    spend: fix2(total.spend),
    revenue: fix2(total.revenue),
    purchase_value: fix2(total.revenue),
    purchases: total.purchases,
    impressions: total.impressions,
    swipes: total.clicks,
    clicks: total.clicks,
    video_views: total.video_views,
    roas: fix2(safeDivide(total.revenue, total.spend)),
    cpa: fix2(safeDivide(total.spend, total.purchases)),
    ctr: fix2(safeDivide(total.clicks, total.impressions) * 100),
    cpc: fix2(safeDivide(total.spend, total.clicks)),
    cpm: fix2(safeDivide(total.spend, total.impressions) * 1000),
    video_view_rate: fix2(safeDivide(total.video_views, total.impressions) * 100)
  };
}

async function getCachedRows({
  admin,
  workspaceId,
  accountId,
  metricDate,
  datePreset,
  entityLevel
}) {
  const { data, error, count } = await admin
    .from("platform_daily_metrics")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("provider", "snapchat")
    .eq("account_id", accountId)
    .eq("metric_date", metricDate)
    .eq("entity_level", entityLevel)
    .filter("raw->>date_preset", "eq", datePreset)
    .order("spend", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return {
    count: count || 0,
    rows: data || []
  };
}

function summarizeCachedRows(rows) {
  return sumMetrics(
    rows.map((row) => ({
      spend: row.spend,
      revenue: row.revenue,
      purchases: row.purchases,
      impressions: row.impressions,
      clicks: row.clicks,
      video_views: row.video_views
    }))
  );
}

function diffValue(source, target) {
  const a = safeNum(source);
  const b = safeNum(target);
  const difference = fix2(a - b);
  const percentage = b ? fix2((difference / b) * 100) : 0;

  return {
    source: fix2(a),
    target: fix2(b),
    difference,
    difference_percentage: percentage
  };
}

function detectLikelyIssue({
  accountSpendOnly,
  liveCampaignSummary,
  cachedCampaignSummary,
  cachedCampaignCount,
  campaignsWithMetrics
}) {
  const notes = [];

  if (!accountSpendOnly.success) {
    notes.push(
      "AdAccount spend-only stats failed. Direct account-level comparison is unavailable."
    );
  }

  if (accountSpendOnly.success && accountSpendOnly.spend > 0) {
    const liveSpend = safeNum(liveCampaignSummary.spend);
    const accountSpend = safeNum(accountSpendOnly.spend);
    const diffPercent = Math.abs(((accountSpend - liveSpend) / accountSpend) * 100);

    if (diffPercent > 10) {
      notes.push(
        "Campaign summed spend is materially different from AdAccount spend. Overview should not rely only on summed campaign stats."
      );
    }
  }

  if (cachedCampaignCount < campaignsWithMetrics) {
    notes.push(
      "Supabase cache has fewer campaign rows than live campaigns with metrics. Run sync with higher limit or fix cache write."
    );
  }

  if (cachedCampaignSummary.spend < liveCampaignSummary.spend * 0.9) {
    notes.push(
      "Cached spend is lower than live campaign spend. The dashboard is likely reading incomplete or old cached data."
    );
  }

  if (!notes.length) {
    notes.push(
      "No obvious cache issue detected. Differences may be caused by attribution windows, saved view filters, or Snapchat Ads Manager reporting logic."
    );
  }

  return notes;
}

export async function GET(request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const startedAt = new Date().toISOString();

  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "this_month";

    const requestedCandidateLimit = Number(
      searchParams.get("candidate_limit") || searchParams.get("scan_limit") || 500
    );

    const candidateLimit = Math.min(Math.max(requestedCandidateLimit, 1), 1000);

    const concurrency = Math.min(
      Math.max(Number(searchParams.get("concurrency") || 6), 1),
      10
    );

    const swRaw = searchParams.get("swipe_window") || "28_DAY";
    const vwRaw = searchParams.get("view_window") || "1_DAY";

    const swipeWindow = VALID_SWIPE_WINDOWS.includes(swRaw) ? swRaw : "28_DAY";
    const viewWindow = VALID_VIEW_WINDOWS.includes(vwRaw) ? vwRaw : "1_DAY";

    if (!accountId) {
      return NextResponse.json(
        {
          success: false,
          error: "account_id is required"
        },
        { status: 400 }
      );
    }

    const { user, workspace } = await getActiveWorkspace(request);
    const token = await getSnapchatToken(request, accountId);

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          provider: "Snapchat Ads",
          version: "snapchat-debug-compare-v2-fixed-build",
          error:
            "Snapchat token not found for this workspace/account. Reconnect Snapchat, then open /api/snapchat/accounts once."
        },
        { status: 401 }
      );
    }

    const admin = createSupabaseAdminClient();
    const workspaceId = workspace.id;
    const metricDate = todayDate();

    const { startTime, endTime } = getDateRange(datePreset);

    const accountSpendOnly = await fetchAdAccountSpendOnly({
      accountId,
      token,
      startTime,
      endTime,
      swipeWindow,
      viewWindow
    });

    const campaignsResult = await fetchCampaigns({
      accountId,
      token
    });

    if (!campaignsResult.success) {
      return NextResponse.json(
        {
          success: false,
          provider: "Snapchat Ads",
          version: "snapchat-debug-compare-v2-fixed-build",
          error: campaignsResult.error,
          status: campaignsResult.status,
          account_id: accountId,
          date_preset: datePreset
        },
        { status: campaignsResult.status || 500 }
      );
    }

    const allCampaigns = campaignsResult.campaigns || [];
    const scannedCampaigns = allCampaigns.slice(0, candidateLimit);

    const campaignStatsRows = await mapWithConcurrency(
      scannedCampaigns,
      concurrency,
      async (campaign) => {
        const statsResult = await fetchCampaignStats({
          campaignId: campaign.id,
          token,
          startTime,
          endTime,
          swipeWindow,
          viewWindow
        });

        return {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          raw_status: campaign.raw_status,
          updated_at: campaign.updated_at,
          success: statsResult.success,
          stats_error: statsResult.error,
          metrics: statsResult.metrics
        };
      }
    );

    const campaignsWithMetrics = campaignStatsRows.filter((row) =>
      hasMeaningfulMetrics(row.metrics)
    );

    const liveCampaignSummary = sumMetrics(campaignsWithMetrics);

    const cachedAccount = await getCachedRows({
      admin,
      workspaceId,
      accountId,
      metricDate,
      datePreset,
      entityLevel: "account"
    });

    const cachedCampaigns = await getCachedRows({
      admin,
      workspaceId,
      accountId,
      metricDate,
      datePreset,
      entityLevel: "campaign"
    });

    const cachedAccountSummary = summarizeCachedRows(cachedAccount.rows);
    const cachedCampaignSummary = summarizeCachedRows(cachedCampaigns.rows);

    const likelyIssues = detectLikelyIssue({
      accountSpendOnly,
      liveCampaignSummary,
      cachedCampaignSummary,
      cachedCampaignCount: cachedCampaigns.count,
      campaignsWithMetrics: campaignsWithMetrics.length
    });

    const finishedAt = new Date().toISOString();

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-debug-compare-v2-fixed-build",

      workspace_id: workspaceId,
      user_id: user.id,
      account_id: accountId,
      date_preset: datePreset,
      metric_date: metricDate,

      timezone: "Asia/Riyadh",
      start_time: startTime,
      end_time: endTime,

      attribution: {
        swipe_window: swipeWindow,
        view_window: viewWindow
      },

      scan: {
        total_campaigns_available: allCampaigns.length,
        scanned_campaigns: scannedCampaigns.length,
        campaigns_with_metrics: campaignsWithMetrics.length,
        candidate_limit: candidateLimit,
        concurrency
      },

      snapchat_account_spend_only: accountSpendOnly,

      live_campaigns_from_snapchat_api: {
        summary: liveCampaignSummary,
        top_10_by_spend: campaignsWithMetrics
          .sort((a, b) => safeNum(b.metrics.spend) - safeNum(a.metrics.spend))
          .slice(0, 10)
      },

      supabase_cache: {
        account_rows: cachedAccount.count,
        campaign_rows: cachedCampaigns.count,
        account_summary: cachedAccountSummary,
        campaign_summary: cachedCampaignSummary
      },

      comparison: {
        account_spend_vs_live_campaign_spend: accountSpendOnly.success
          ? diffValue(accountSpendOnly.spend, liveCampaignSummary.spend)
          : null,

        live_campaign_spend_vs_cached_campaign_spend: diffValue(
          liveCampaignSummary.spend,
          cachedCampaignSummary.spend
        ),

        live_campaign_revenue_vs_cached_campaign_revenue: diffValue(
          liveCampaignSummary.revenue,
          cachedCampaignSummary.revenue
        ),

        live_campaign_purchases_vs_cached_campaign_purchases: diffValue(
          liveCampaignSummary.purchases,
          cachedCampaignSummary.purchases
        )
      },

      likely_issues: likelyIssues,

      started_at: startedAt,
      finished_at: finishedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "Snapchat Ads",
        version: "snapchat-debug-compare-v2-fixed-build",
        error: error.message || "Snapchat debug compare failed"
      },
      { status: error.status || 500 }
    );
  }
}
