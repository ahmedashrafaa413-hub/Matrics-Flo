import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

const FIELDS = [
  "impressions",
  "spend",
  "swipes",
  "conversion_purchases",
  "conversion_purchases_value",
  "video_views"
];

const DEFAULT_LIMIT = 20;
const MAX_SAFE_LIMIT = 40;
const DELAY_BETWEEN_REQUESTS_MS = 350;

const memoryCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function moneyFromMicros(value) {
  return safeNumber(value) / 1000000;
}

function getCacheKey({ accountId, level, datePreset, limit }) {
  return `${accountId}:${level}:${datePreset}:${limit}`;
}

function getCachedResult(key) {
  const cached = memoryCache.get(key);

  if (!cached) return null;

  const age = Date.now() - cached.createdAt;

  if (age > 1000 * 60 * 5) {
    memoryCache.delete(key);
    return null;
  }

  return cached.data;
}

function setCachedResult(key, data) {
  memoryCache.set(key, {
    createdAt: Date.now(),
    data
  });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function getRiyadhDateParts(date = new Date()) {
  const riyadhNow = new Date(date.getTime() + 3 * 60 * 60 * 1000);

  return {
    year: riyadhNow.getUTCFullYear(),
    month: riyadhNow.getUTCMonth() + 1,
    day: riyadhNow.getUTCDate(),
    hour: riyadhNow.getUTCHours()
  };
}

function dateOnlyToUTCDate({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function addDaysToParts(parts, days) {
  const d = dateOnlyToUTCDate(parts);
  d.setUTCDate(d.getUTCDate() + days);

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate()
  };
}

function addMonthsStart(parts, monthsBack) {
  const d = dateOnlyToUTCDate({
    year: parts.year,
    month: parts.month,
    day: 1
  });

  d.setUTCMonth(d.getUTCMonth() - monthsBack);

  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: 1
  };
}

function toRiyadhTimestamp(parts, hour = 0) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(
    hour
  )}:00:00.000+03:00`;
}

function getDateRange(datePreset) {
  const nowParts = getRiyadhDateParts();

  const today = {
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day
  };

  const currentHour = nowParts.hour;
  const nextHour = Math.min(currentHour + 1, 23);

  let startParts = today;
  let endParts = today;
  let startHour = 0;
  let endHour = nextHour;

  if (datePreset === "today") {
    startParts = today;
    endParts = today;
  } else if (datePreset === "yesterday") {
    startParts = addDaysToParts(today, -1);
    endParts = today;
    endHour = 0;
  } else if (datePreset === "last_7d") {
    startParts = addDaysToParts(today, -6);
    endParts = today;
  } else if (datePreset === "last_30d") {
    startParts = addDaysToParts(today, -29);
    endParts = today;
  } else if (datePreset === "this_month") {
    startParts = {
      year: today.year,
      month: today.month,
      day: 1
    };
    endParts = today;
  } else if (datePreset === "last_90d") {
    startParts = addDaysToParts(today, -89);
    endParts = today;
  } else if (datePreset === "maximum") {
    startParts = addMonthsStart(today, 36);
    endParts = today;
  } else {
    startParts = addDaysToParts(today, -29);
    endParts = today;
  }

  return {
    startTime: toRiyadhTimestamp(startParts, startHour),
    endTime: toRiyadhTimestamp(endParts, endHour)
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
      raw: text.slice(0, 2000)
    };
  }
}

async function snapFetch(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  return readJsonResponse(response);
}

function getDeliveryStatusText(entity) {
  const delivery = entity?.delivery_status;

  if (Array.isArray(delivery)) {
    return delivery.join(" ");
  }

  if (typeof delivery === "string") {
    return delivery;
  }

  return "";
}

function getNormalizedStatus(entity) {
  const status = String(entity?.status || "").toUpperCase();
  const effectiveStatus = String(entity?.effective_status || "").toUpperCase();
  const configuredStatus = String(entity?.configured_status || "").toUpperCase();
  const deliveryStatus = getDeliveryStatusText(entity).toUpperCase();

  if (
    status === "ACTIVE" ||
    effectiveStatus === "ACTIVE" ||
    configuredStatus === "ACTIVE"
  ) {
    return "ACTIVE";
  }

  if (
    status === "PAUSED" ||
    effectiveStatus === "PAUSED" ||
    configuredStatus === "PAUSED"
  ) {
    return "PAUSED";
  }

  if (
    status === "PENDING" ||
    effectiveStatus === "PENDING" ||
    configuredStatus === "PENDING"
  ) {
    return "PENDING";
  }

  if (deliveryStatus.includes("ACTIVE")) {
    return "ACTIVE";
  }

  if (deliveryStatus.includes("PAUSED")) {
    return "PAUSED";
  }

  return status || effectiveStatus || configuredStatus || "UNKNOWN";
}

function getStatusRank(status) {
  const st = String(status || "").toUpperCase();

  if (st === "ACTIVE") return 1;
  if (st === "PENDING") return 2;
  if (st === "PAUSED") return 3;

  return 4;
}

function sortEntitiesActiveFirst(entities) {
  return [...entities].sort((a, b) => {
    const statusDiff = getStatusRank(a.status) - getStatusRank(b.status);

    if (statusDiff !== 0) return statusDiff;

    const aUpdated = new Date(a.raw?.updated_at || a.raw?.created_at || 0).getTime();
    const bUpdated = new Date(b.raw?.updated_at || b.raw?.created_at || 0).getTime();

    if (aUpdated !== bUpdated) return bUpdated - aUpdated;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function extractCampaigns(payload) {
  const rows = payload?.campaigns || [];

  return rows
    .map((item) => item.campaign || item)
    .filter(Boolean)
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name || "Unnamed Campaign",
      campaign_name: campaign.name || "Unnamed Campaign",
      status: getNormalizedStatus(campaign),
      raw: campaign
    }));
}

function extractAdSquads(payload) {
  const rows = payload?.adsquads || [];

  return rows
    .map((item) => item.adsquad || item)
    .filter(Boolean)
    .map((adsquad) => ({
      id: adsquad.id,
      name: adsquad.name || "Unnamed Ad Squad",
      adsquad_name: adsquad.name || "Unnamed Ad Squad",
      campaign_id: adsquad.campaign_id || "",
      status: getNormalizedStatus(adsquad),
      raw: adsquad
    }));
}

function extractAds(payload) {
  const rows = payload?.ads || [];

  return rows
    .map((item) => item.ad || item)
    .filter(Boolean)
    .map((ad) => ({
      id: ad.id,
      name: ad.name || "Unnamed Ad",
      ad_name: ad.name || "Unnamed Ad",
      adsquad_id: ad.ad_squad_id || ad.adsquad_id || "",
      campaign_id: ad.campaign_id || "",
      status: getNormalizedStatus(ad),
      raw: ad
    }));
}

function extractStats(payload, entityId) {
  const totalStats = payload?.total_stats || [];

  const match =
    totalStats.find((item) => {
      const stat = item.total_stat || item;
      return stat?.id === entityId;
    }) ||
    totalStats[0] ||
    null;

  const totalStat = match?.total_stat || match || {};
  const stats = totalStat?.stats || {};

  return stats || {};
}

function normalizeRow(entity, stats, meta = {}) {
  const spend = moneyFromMicros(stats.spend);
  const impressions = safeNumber(stats.impressions);
  const swipes = safeNumber(stats.swipes);
  const purchases = safeNumber(stats.conversion_purchases);
  const revenue = moneyFromMicros(stats.conversion_purchases_value);
  const videoViews = safeNumber(stats.video_views);

  const ctr = safeDivide(swipes, impressions) * 100;
  const cpc = safeDivide(spend, swipes);
  const cpm = safeDivide(spend, impressions) * 1000;
  const roas = safeDivide(revenue, spend);
  const cpa = safeDivide(spend, purchases);
  const videoViewRate = safeDivide(videoViews, impressions) * 100;

  return {
    ...entity,

    spend,
    impressions,
    swipes,
    clicks: swipes,
    ctr,
    cpc,
    cpm,

    purchases,
    purchase_value: revenue,
    revenue,
    roas,
    cpa,

    video_views: videoViews,
    video_view_rate: videoViewRate,

    has_stats: meta.hasStats || false,
    stats_status: meta.status || null,
    stats_error: meta.error || null,

    _raw_stats: stats
  };
}

function buildSummary(rows) {
  const total = rows.reduce(
    (acc, row) => {
      acc.spend += safeNumber(row.spend);
      acc.impressions += safeNumber(row.impressions);
      acc.swipes += safeNumber(row.swipes);
      acc.purchases += safeNumber(row.purchases);
      acc.revenue += safeNumber(row.revenue);
      acc.video_views += safeNumber(row.video_views);

      return acc;
    },
    {
      spend: 0,
      impressions: 0,
      swipes: 0,
      purchases: 0,
      revenue: 0,
      video_views: 0
    }
  );

  return {
    ...total,
    clicks: total.swipes,
    ctr: safeDivide(total.swipes, total.impressions) * 100,
    cpc: safeDivide(total.spend, total.swipes),
    cpm: safeDivide(total.spend, total.impressions) * 1000,
    roas: safeDivide(total.revenue, total.spend),
    cpa: safeDivide(total.spend, total.purchases),
    video_view_rate: safeDivide(total.video_views, total.impressions) * 100
  };
}

async function getEntities({ accountId, level, token }) {
  if (level === "campaign") {
    const url = `${BASE}/adaccounts/${accountId}/campaigns?limit=200`;
    const result = await snapFetch(url, token);

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: result.data || result.raw
      };
    }

    return {
      ok: true,
      entities: extractCampaigns(result.data)
    };
  }

  if (level === "adsquad") {
    const url = `${BASE}/adaccounts/${accountId}/adsquads?limit=200`;
    const result = await snapFetch(url, token);

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: result.data || result.raw
      };
    }

    return {
      ok: true,
      entities: extractAdSquads(result.data)
    };
  }

  if (level === "ad") {
    const url = `${BASE}/adaccounts/${accountId}/ads?limit=200`;
    const result = await snapFetch(url, token);

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: result.data || result.raw
      };
    }

    return {
      ok: true,
      entities: extractAds(result.data)
    };
  }

  return {
    ok: false,
    status: 400,
    error: "Invalid level. Use campaign, adsquad, or ad."
  };
}

function getStatsEntityType(level) {
  if (level === "campaign") return "campaigns";
  if (level === "adsquad") return "adsquads";
  if (level === "ad") return "ads";

  return "campaigns";
}

async function getEntityStats({
  entityType,
  entityId,
  token,
  startTime,
  endTime
}) {
  const url =
    `${BASE}/${entityType}/${entityId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(FIELDS.join(","))}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}`;

  const result = await snapFetch(url, token);

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.data || result.raw,
      url
    };
  }

  return {
    ok: true,
    status: result.status,
    stats: extractStats(result.data, entityId),
    url
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const accountId = searchParams.get("account_id");
  const level = searchParams.get("level") || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_30d";
  const force = searchParams.get("force") === "1";

  const requestedLimit = Number(searchParams.get("limit") || DEFAULT_LIMIT);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT, 1),
    MAX_SAFE_LIMIT
  );

  if (!accountId) {
    return NextResponse.json({
      success: false,
      error: "account_id is required"
    });
  }

  const cacheKey = getCacheKey({
    accountId,
    level,
    datePreset,
    limit
  });

  if (!force) {
    const cached = getCachedResult(cacheKey);

    if (cached) {
      return NextResponse.json({
        ...cached,
        cached: true
      });
    }
  }

  const token = await getSnapchatToken();

  if (!token) {
    return NextResponse.json({
      success: false,
      error: "Not connected to Snapchat"
    });
  }

  const { startTime, endTime } = getDateRange(datePreset);

  const entitiesResult = await getEntities({
    accountId,
    level,
    token
  });

  if (!entitiesResult.ok) {
    return NextResponse.json({
      success: false,
      source: "entities",
      level,
      status: entitiesResult.status,
      error: entitiesResult.error
    });
  }

  const entities = entitiesResult.entities || [];
  const sortedEntities = sortEntitiesActiveFirst(entities);
  const entityType = getStatsEntityType(level);
  const limitedEntities = sortedEntities.slice(0, limit);

  const rows = [];
  const errors = [];

  for (const entity of limitedEntities) {
    const statsResult = await getEntityStats({
      entityType,
      entityId: entity.id,
      token,
      startTime,
      endTime
    });

    if (statsResult.ok) {
      rows.push(
        normalizeRow(entity, statsResult.stats, {
          hasStats: true,
          status: statsResult.status
        })
      );
    } else {
      errors.push({
        entity_id: entity.id,
        entity_name: entity.name,
        status: statsResult.status,
        error: statsResult.error
      });

      rows.push(
        normalizeRow(
          entity,
          {},
          {
            hasStats: false,
            status: statsResult.status,
            error:
              statsResult.status === 429
                ? "Rate limited by Snapchat"
                : "Stats unavailable"
          }
        )
      );

      if (statsResult.status === 429) {
        break;
      }
    }

    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  const summary = buildSummary(rows);

  const payload = {
    success: true,
    version: "snapchat-insights-v6-active-filter-sort-ready",
    account_id: accountId,
    level,
    date_preset: datePreset,
    entity_type: entityType,
    timezone: "Asia/Riyadh",
    start_time: startTime,
    end_time: endTime,
    fields: FIELDS,
    count: rows.length,
    total_entities_available: entities.length,
    loaded_limit: limit,
    partial_data: rows.length < entities.length,
    active_first: true,
    rate_limited: errors.some((error) => error.status === 429),
    errors,
    summary,
    data: rows
  };

  setCachedResult(cacheKey, payload);

  return NextResponse.json(payload);
}
