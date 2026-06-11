import { getSnapchatToken } from "../../../../lib/snapchatToken";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

const SERVER_CACHE = globalThis.__snapchatCache || new Map();
globalThis.__snapchatCache = SERVER_CACHE;

function getCache(key) {
  const item = SERVER_CACHE.get(key);

  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    SERVER_CACHE.delete(key);
    return null;
  }

  return item.value;
}

function setCache(key, value, ttlMs = 120000) {
  SERVER_CACHE.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function safeDivide(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);

  if (!y) return 0;

  return x / y;
}

function buildDateParams(datePreset, since, until) {
  const today = new Date().toISOString().split("T")[0];

  function toEnd(dateStr) {
    const d = new Date(dateStr + "T00:00:00.000Z");
    d.setDate(d.getDate() + 1);

    return d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  }

  if (since && until) {
    return {
      start_time: `${since}T00:00:00.000Z`,
      end_time: toEnd(until)
    };
  }

  const presets = {
    today: {
      start: today,
      end: today
    },

    yesterday: {
      start: daysAgo(1),
      end: daysAgo(1)
    },

    last_7d: {
      start: daysAgo(7),
      end: today
    },

    last_30d: {
      start: daysAgo(30),
      end: today
    },

    last_90d: {
      start: daysAgo(90),
      end: today
    },

    this_month: {
      start: `${today.slice(0, 7)}-01`,
      end: today
    },

    maximum: {
      start: daysAgo(1095),
      end: today
    }
  };

  const range = presets[datePreset] || presets.last_30d;

  return {
    start_time: `${range.start}T00:00:00.000Z`,
    end_time: toEnd(range.end)
  };
}

async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return {
      ok: response.ok,
      status: response.status,
      data: JSON.parse(text),
      raw: null
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      raw: text.slice(0, 1000)
    };
  }
}

async function snap(path, token, cacheTtl = 120000) {
  const cacheKey = `snap:${path}`;
  const cached = getCache(cacheKey);

  if (cached) return cached;

  const response = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  const result = await readJsonResponse(response);

  if (!result.ok) {
    if (result.status === 429 || String(result.raw || "").includes("Too Many Requests")) {
      throw new Error(
        "Snapchat API rate limit reached. Please wait 5 minutes before refreshing again."
      );
    }

    throw new Error(
      result.data?.request_status ||
        result.data?.message ||
        result.data?.debug_message ||
        result.data?.error ||
        result.raw ||
        `Snapchat API error: ${result.status}`
    );
  }

  setCache(cacheKey, result.data, cacheTtl);

  return result.data;
}

const STATS_FIELDS = [
  "impressions",
  "swipes",
  "spend",
  "video_views",
  "view_completion_1_quarter",
  "view_completion_2_quarter",
  "view_completion_3_quarter",
  "view_completion_4_quarter",
  "frequency",
  "reach",
  "conversion_purchases",
  "conversion_purchases_value"
].join(",");

function mergeStatsFromResponse(data) {
  const totalStats =
    data?.total_stats?.[0]?.total_stat?.stats || null;

  if (totalStats) return totalStats;

  const timeseries =
    data?.timeseries_stats?.[0]?.timeseries_stat?.timeseries || [];

  const merged = {};

  timeseries.forEach((point) => {
    const stats = point.stats || {};

    Object.entries(stats).forEach(([key, value]) => {
      merged[key] = Number(merged[key] || 0) + Number(value || 0);
    });
  });

  return merged;
}

async function fetchSingleStat(entityType, id, dateParams, token) {
  const cacheKey = `snap:stats:${entityType}:${id}:${dateParams.start_time}:${dateParams.end_time}`;
  const cached = getCache(cacheKey);

  if (cached) return cached;

  const url =
    `${BASE}/${entityType}/${id}/stats` +
    `?granularity=DAY` +
    `&fields=${encodeURIComponent(STATS_FIELDS)}` +
    `&start_time=${encodeURIComponent(dateParams.start_time)}` +
    `&end_time=${encodeURIComponent(dateParams.end_time)}` +
    `&swipe_up_attribution_window=28_DAY` +
    `&view_attribution_window=7_DAY`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  const result = await readJsonResponse(response);

  if (!result.ok) {
    if (result.status === 429 || String(result.raw || "").includes("Too Many Requests")) {
      return {
        stats: {},
        debug: {
          entityType,
          id,
          status: 429,
          url,
          error:
            "Snapchat API rate limit reached. Please wait 5 minutes before refreshing again."
        }
      };
    }

    return {
      stats: {},
      debug: {
        entityType,
        id,
        status: result.status,
        url,
        error: result.data || result.raw
      }
    };
  }

  const stats = mergeStatsFromResponse(result.data);

  const output = {
    stats,
    debug: {
      entityType,
      id,
      status: result.status,
      url,
      raw_response: result.data,
      parsed_stats: stats
    }
  };

  setCache(cacheKey, output, 120000);

  return output;
}

async function fetchStats(entityType, ids, dateParams, token) {
  const statsMap = {};
  const chunkSize = 3;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);

    const settled = await Promise.allSettled(
      chunk.map(async (id) => {
        const result = await fetchSingleStat(entityType, id, dateParams, token);

        statsMap[id] = result.stats || {};

        if (!statsMap.__debug__) {
          statsMap.__debug__ = result.debug || null;
        }
      })
    );

    const has429 = settled.some((item) => {
      return (
        item.status === "fulfilled" &&
        statsMap.__debug__?.status === 429
      );
    });

    if (has429) break;

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return statsMap;
}

function normalizeEntity(entity, level) {
  if (level === "campaign") {
    return {
      id: entity.id,
      name: entity.name,
      status: entity.status,
      campaign_id: entity.id,
      campaign_name: entity.name,
      adsquad_id: null,
      adsquad_name: null,
      ad_id: null,
      ad_name: null
    };
  }

  if (level === "adsquad") {
    return {
      id: entity.id,
      name: entity.name,
      status: entity.status,
      campaign_id: entity.campaign_id || null,
      campaign_name: entity.campaign_name || "",
      adsquad_id: entity.id,
      adsquad_name: entity.name,
      ad_id: null,
      ad_name: null
    };
  }

  return {
    id: entity.id,
    name: entity.name,
    status: entity.status,
    campaign_id: entity.campaign_id || null,
    campaign_name: entity.campaign_name || "",
    adsquad_id: entity.ad_squad_id || entity.adsquad_id || null,
    adsquad_name: entity.ad_squad_name || entity.adsquad_name || "",
    ad_id: entity.id,
    ad_name: entity.name
  };
}

function enrichEntity(entity, stats, level) {
  const identity = normalizeEntity(entity, level);

  const spend = Number(stats.spend || 0) / 1_000_000;
  const impressions = Number(stats.impressions || 0);
  const swipes = Number(stats.swipes || 0);
  const reach = Number(stats.reach || 0);

  const videoViews = Number(stats.video_views || 0);

  const video25 = Number(stats.view_completion_1_quarter || 0);
  const video50 = Number(stats.view_completion_2_quarter || 0);
  const video75 = Number(stats.view_completion_3_quarter || 0);
  const video100 = Number(stats.view_completion_4_quarter || 0);

  const purchases = Number(stats.conversion_purchases || 0);
  const purchaseValue =
    Number(stats.conversion_purchases_value || 0) / 1_000_000;

  const frequency =
    Number(stats.frequency || 0) || safeDivide(impressions, reach);

  const ctr = safeDivide(swipes, impressions) * 100;
  const cpc = safeDivide(spend, swipes);
  const cpm = safeDivide(spend, impressions) * 1000;
  const roas = safeDivide(purchaseValue, spend);
  const cpa = safeDivide(spend, purchases);

  const hookRate = safeDivide(videoViews, impressions) * 100;
  const holdRate = safeDivide(video50, video25 || videoViews) * 100;
  const completionRate = safeDivide(video100, videoViews) * 100;

  return {
    ...identity,

    spend: Number(spend.toFixed(2)),
    impressions,
    swipes,
    clicks: swipes,
    reach,
    frequency: Number(frequency.toFixed(2)),

    ctr: Number(ctr.toFixed(2)),
    cpc: Number(cpc.toFixed(2)),
    cpm: Number(cpm.toFixed(2)),

    purchases,
    purchase_value: Number(purchaseValue.toFixed(2)),
    roas: Number(roas.toFixed(2)),
    cpa: Number(cpa.toFixed(2)),

    video_views: videoViews,
    video_25: video25,
    video_50: video50,
    video_75: video75,
    video_100: video100,

    hook_rate: Number(hookRate.toFixed(2)),
    hold_rate: Number(holdRate.toFixed(2)),
    completion_rate: Number(completionRate.toFixed(2)),

    _raw: stats
  };
}

function buildSummary(rows) {
  const summary = rows.reduce(
    (acc, row) => {
      acc.spend += Number(row.spend || 0);
      acc.impressions += Number(row.impressions || 0);
      acc.clicks += Number(row.clicks || 0);
      acc.reach += Number(row.reach || 0);
      acc.purchases += Number(row.purchases || 0);
      acc.purchase_value += Number(row.purchase_value || 0);
      acc.video_views += Number(row.video_views || 0);

      return acc;
    },
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      purchases: 0,
      purchase_value: 0,
      video_views: 0
    }
  );

  summary.roas = Number(
    safeDivide(summary.purchase_value, summary.spend).toFixed(2)
  );

  summary.cpa = Number(
    safeDivide(summary.spend, summary.purchases).toFixed(2)
  );

  summary.ctr = Number(
    (safeDivide(summary.clicks, summary.impressions) * 100).toFixed(2)
  );

  summary.cpc = Number(
    safeDivide(summary.spend, summary.clicks).toFixed(2)
  );

  summary.cpm = Number(
    (safeDivide(summary.spend, summary.impressions) * 1000).toFixed(2)
  );

  return summary;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const token = searchParams.get("token") || (await getSnapchatToken());
  const accountId = searchParams.get("account_id");
  const level = searchParams.get("level") || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_30d";
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  if (!token) {
    return NextResponse.json(
      {
        success: false,
        error: "Not connected to Snapchat"
      },
      { status: 401 }
    );
  }

  if (!accountId) {
    return NextResponse.json(
      {
        success: false,
        error: "account_id is required"
      },
      { status: 400 }
    );
  }

  try {
    const dateParams = buildDateParams(datePreset, since, until);

    let entities = [];
    let statsEntityType = "campaigns";

    if (level === "campaign") {
      const data = await snap(
        `/adaccounts/${accountId}/campaigns?limit=50`,
        token
      );

      entities = (data.campaigns || [])
        .map((item) => item.campaign)
        .filter(Boolean);

      statsEntityType = "campaigns";
    } else if (level === "adsquad") {
      const data = await snap(
        `/adaccounts/${accountId}/adsquads?limit=50`,
        token
      );

      entities = (data.adsquads || [])
        .map((item) => item.adsquad)
        .filter(Boolean);

      statsEntityType = "adsquads";
    } else if (level === "ad") {
      const data = await snap(
        `/adaccounts/${accountId}/ads?limit=50`,
        token
      );

      entities = (data.ads || [])
        .map((item) => item.ad)
        .filter(Boolean);

      statsEntityType = "ads";
    } else {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid level. Use campaign, adsquad, or ad."
        },
        { status: 400 }
      );
    }

    const ids = entities.map((entity) => entity.id).filter(Boolean);

    const statsMap = await fetchStats(statsEntityType, ids, dateParams, token);

    const enriched = entities.map((entity) =>
      enrichEntity(entity, statsMap[entity.id] || {}, level)
    );

    const summary = buildSummary(enriched);

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      account_id: accountId,
      level,
      date_preset: since && until ? "custom" : datePreset,
      date_range: dateParams,
      rows_count: enriched.length,
      data: enriched,
      summary,
      debug: statsMap.__debug__ || null
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Internal server error"
      },
      { status: 500 }
    );
  }
}
