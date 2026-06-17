import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const SNAP_API_BASE = "https://adsapi.snapchat.com/v1";

const DEFAULT_LIMIT = 20;
const MAX_SAFE_LIMIT = 40;
const DELAY_BETWEEN_REQUESTS_MS = 350;

/**
 * Important:
 * These are the safe fields we already tested successfully.
 * Do not add unsupported Snapchat fields here before testing them first.
 */
const FIELDS = [
  "impressions",
  "spend",
  "swipes",
  "conversion_purchases",
  "conversion_purchases_value",
  "video_views"
].join(",");

function wait(ms) {
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

function microsToMoney(value) {
  return safeNumber(value) / 1000000;
}

function clampLimit(value) {
  const n = Number(value || DEFAULT_LIMIT);

  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  if (n < 1) return DEFAULT_LIMIT;
  if (n > MAX_SAFE_LIMIT) return MAX_SAFE_LIMIT;

  return n;
}

function toSnapEntityType(level) {
  if (level === "campaign") return "campaigns";
  if (level === "ad_squad") return "adsquads";
  if (level === "ad") return "ads";

  return "campaigns";
}

function toSnapListPath(accountId, level) {
  if (level === "campaign") {
    return `/adaccounts/${accountId}/campaigns`;
  }

  if (level === "ad_squad") {
    return `/adaccounts/${accountId}/adsquads`;
  }

  if (level === "ad") {
    return `/adaccounts/${accountId}/ads`;
  }

  return `/adaccounts/${accountId}/campaigns`;
}

function getEntityId(entity, level) {
  if (!entity) return "";

  if (level === "campaign") {
    return entity.id || entity.campaign_id || entity.campaign?.id || "";
  }

  if (level === "ad_squad") {
    return entity.id || entity.adsquad_id || entity.ad_squad_id || entity.adsquad?.id || "";
  }

  if (level === "ad") {
    return entity.id || entity.ad_id || entity.ad?.id || "";
  }

  return entity.id || "";
}

function getEntityName(entity, level) {
  if (!entity) return "Untitled";

  if (entity.name) return entity.name;

  if (level === "campaign") {
    return entity.campaign?.name || entity.campaign_name || "Untitled Campaign";
  }

  if (level === "ad_squad") {
    return (
      entity.adsquad?.name ||
      entity.ad_squad?.name ||
      entity.adsquad_name ||
      "Untitled Ad Squad"
    );
  }

  if (level === "ad") {
    return entity.ad?.name || entity.ad_name || "Untitled Ad";
  }

  return "Untitled";
}

function normalizeStatus(value) {
  const status = String(value || "").toUpperCase();

  if (
    status.includes("ACTIVE") ||
    status.includes("RUNNING") ||
    status.includes("DELIVERING")
  ) {
    return "ACTIVE";
  }

  if (
    status.includes("PAUSED") ||
    status.includes("STOPPED") ||
    status.includes("INACTIVE")
  ) {
    return "PAUSED";
  }

  if (status.includes("DELETED") || status.includes("ARCHIVED")) {
    return "DELETED";
  }

  if (status.includes("PENDING")) {
    return "PENDING";
  }

  return status || "UNKNOWN";
}

function getEntityStatus(entity) {
  return normalizeStatus(
    entity?.effective_status ||
      entity?.delivery_status ||
      entity?.configured_status ||
      entity?.status ||
      entity?.campaign?.status ||
      entity?.adsquad?.status ||
      entity?.ad?.status
  );
}

function getUpdatedAt(entity) {
  return (
    entity?.updated_at ||
    entity?.created_at ||
    entity?.campaign?.updated_at ||
    entity?.campaign?.created_at ||
    entity?.adsquad?.updated_at ||
    entity?.adsquad?.created_at ||
    entity?.ad?.updated_at ||
    entity?.ad?.created_at ||
    ""
  );
}

function sortEntitiesActiveFirst(entities) {
  return [...entities].sort((a, b) => {
    const aActive = getEntityStatus(a) === "ACTIVE";
    const bActive = getEntityStatus(b) === "ACTIVE";

    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;

    const aDate = new Date(getUpdatedAt(a)).getTime() || 0;
    const bDate = new Date(getUpdatedAt(b)).getTime() || 0;

    return bDate - aDate;
  });
}

function normalizeSnapchatContainer(data, level) {
  if (!data) return [];

  const possibleKeys = {
    campaign: ["campaigns", "campaign"],
    ad_squad: ["adsquads", "ad_squads", "adsquad", "adSquads"],
    ad: ["ads", "ad"]
  };

  const keys = possibleKeys[level] || possibleKeys.campaign;

  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key];
  }

  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;

  return [];
}

function getRiyadhDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return { year, month, day };
}

function riyadhStartOfDay(date) {
  const { year, month, day } = getRiyadhDateParts(date);
  return `${year}-${month}-${day}T00:00:00.000+03:00`;
}

function riyadhEndOfDay(date) {
  const { year, month, day } = getRiyadhDateParts(date);
  return `${year}-${month}-${day}T23:00:00.000+03:00`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getDateRange(datePreset) {
  const now = new Date();

  if (datePreset === "today") {
    return {
      start_time: riyadhStartOfDay(now),
      end_time: riyadhEndOfDay(now)
    };
  }

  if (datePreset === "yesterday") {
    const yesterday = addDays(now, -1);

    return {
      start_time: riyadhStartOfDay(yesterday),
      end_time: riyadhEndOfDay(yesterday)
    };
  }

  if (datePreset === "last_7d") {
    return {
      start_time: riyadhStartOfDay(addDays(now, -7)),
      end_time: riyadhEndOfDay(now)
    };
  }

  if (datePreset === "last_30d") {
    return {
      start_time: riyadhStartOfDay(addDays(now, -30)),
      end_time: riyadhEndOfDay(now)
    };
  }

  if (datePreset === "this_month") {
    const { year, month } = getRiyadhDateParts(now);

    return {
      start_time: `${year}-${month}-01T00:00:00.000+03:00`,
      end_time: riyadhEndOfDay(now)
    };
  }

  if (datePreset === "last_90d") {
    return {
      start_time: riyadhStartOfDay(addDays(now, -90)),
      end_time: riyadhEndOfDay(now)
    };
  }

  if (datePreset === "maximum") {
    return {
      start_time: "2020-01-01T00:00:00.000+03:00",
      end_time: riyadhEndOfDay(now)
    };
  }

  return {
    start_time: riyadhStartOfDay(addDays(now, -30)),
    end_time: riyadhEndOfDay(now)
  };
}

async function snapchatFetch(path, accessToken) {
  const url = `${SNAP_API_BASE}${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    cache: "no-store"
  });

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw_response: text
    };
  }

  if (!response.ok) {
    return {
      success: false,
      status: response.status,
      error: data?.request_status || data?.message || data?.debug_message || text,
      data
    };
  }

  return {
    success: true,
    status: response.status,
    data
  };
}

async function getEntities({ accountId, level, accessToken }) {
  const path = toSnapListPath(accountId, level);
  const result = await snapchatFetch(path, accessToken);

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      status: result.status,
      entities: []
    };
  }

  const entities = normalizeSnapchatContainer(result.data, level);

  return {
    success: true,
    entities
  };
}

function extractStatsObject(data) {
  if (!data) return {};

  const root =
    data.timeseries_stats ||
    data.total_stats ||
    data.stats ||
    data.lifetime_stats ||
    data;

  if (Array.isArray(root)) {
    const first = root[0] || {};
    return first.stats || first;
  }

  if (Array.isArray(root.timeseries)) {
    const first = root.timeseries[0] || {};
    return first.stats || first;
  }

  if (root.stats) return root.stats;

  return root;
}

async function getEntityStats({
  entityType,
  entityId,
  accessToken,
  startTime,
  endTime
}) {
  const params = new URLSearchParams();

  params.set("granularity", "TOTAL");
  params.set("fields", FIELDS);
  params.set("start_time", startTime);
  params.set("end_time", endTime);

  const path = `/${entityType}/${entityId}/stats?${params.toString()}`;

  const result = await snapchatFetch(path, accessToken);

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    status: result.status,
    data: extractStatsObject(result.data)
  };
}

function normalizeRow({ entity, level, stats }) {
  const spend = microsToMoney(stats.spend);
  const revenue = microsToMoney(stats.conversion_purchases_value);
  const impressions = safeNumber(stats.impressions);
  const swipes = safeNumber(stats.swipes);
  const purchases = safeNumber(stats.conversion_purchases);
  const videoViews = safeNumber(stats.video_views);

  const ctr = safeDivide(swipes, impressions) * 100;
  const cpc = safeDivide(spend, swipes);
  const cpm = safeDivide(spend, impressions) * 1000;
  const roas = safeDivide(revenue, spend);
  const cpa = safeDivide(spend, purchases);
  const videoViewRate = safeDivide(videoViews, impressions) * 100;

  const id = getEntityId(entity, level);

  return {
    id,
    name: getEntityName(entity, level),
    status: getEntityStatus(entity),
    level,

    spend,
    revenue,
    impressions,
    swipes,
    clicks: swipes,
    purchases,
    video_views: videoViews,

    ctr,
    cpc,
    cpm,
    roas,
    cpa,
    video_view_rate: videoViewRate,

    currency: "USD",
    updated_at: getUpdatedAt(entity)
  };
}

function buildSummary(rows) {
  const spend = rows.reduce((sum, row) => sum + safeNumber(row.spend), 0);
  const revenue = rows.reduce((sum, row) => sum + safeNumber(row.revenue), 0);
  const impressions = rows.reduce(
    (sum, row) => sum + safeNumber(row.impressions),
    0
  );
  const swipes = rows.reduce((sum, row) => sum + safeNumber(row.swipes), 0);
  const purchases = rows.reduce(
    (sum, row) => sum + safeNumber(row.purchases),
    0
  );
  const videoViews = rows.reduce(
    (sum, row) => sum + safeNumber(row.video_views),
    0
  );

  return {
    currency: "USD",

    spend,
    revenue,
    impressions,
    swipes,
    clicks: swipes,
    purchases,
    video_views: videoViews,

    ctr: safeDivide(swipes, impressions) * 100,
    cpc: safeDivide(spend, swipes),
    cpm: safeDivide(spend, impressions) * 1000,
    roas: safeDivide(revenue, spend),
    cpa: safeDivide(spend, purchases),
    video_view_rate: safeDivide(videoViews, impressions) * 100
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const accountId = searchParams.get("account_id");
  const level = searchParams.get("level") || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_30d";
  const limit = clampLimit(searchParams.get("limit"));

  if (!accountId) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing account_id"
      },
      { status: 400 }
    );
  }

  const allowedLevels = ["campaign", "ad_squad", "ad"];

  if (!allowedLevels.includes(level)) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid level. Use campaign, ad_squad, or ad."
      },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getSnapchatToken();

    if (!accessToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing Snapchat access token. Please reconnect Snapchat."
        },
        { status: 401 }
      );
    }

    const { start_time, end_time } = getDateRange(datePreset);

    const entitiesResult = await getEntities({
      accountId,
      level,
      accessToken
    });

    if (!entitiesResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: entitiesResult.error || "Failed to load Snapchat entities",
          status: entitiesResult.status || null
        },
        { status: entitiesResult.status || 500 }
      );
    }

    const allEntities = sortEntitiesActiveFirst(entitiesResult.entities);
    const selectedEntities = allEntities.slice(0, limit);

    const entityType = toSnapEntityType(level);

    const rows = [];
    const errors = [];
    let rateLimited = false;

    for (const entity of selectedEntities) {
      const entityId = getEntityId(entity, level);

      if (!entityId) {
        errors.push({
          name: getEntityName(entity, level),
          error: "Missing entity id"
        });
        continue;
      }

      const statsResult = await getEntityStats({
        entityType,
        entityId,
        accessToken,
        startTime: start_time,
        endTime: end_time
      });

      if (!statsResult.success) {
        if (statsResult.status === 429) {
          rateLimited = true;
        }

        errors.push({
          id: entityId,
          name: getEntityName(entity, level),
          status: statsResult.status,
          error: statsResult.error
        });

        await wait(DELAY_BETWEEN_REQUESTS_MS);
        continue;
      }

      rows.push(
        normalizeRow({
          entity,
          level,
          stats: statsResult.data || {}
        })
      );

      await wait(DELAY_BETWEEN_REQUESTS_MS);
    }

    const summary = buildSummary(rows);

    return NextResponse.json({
      success: true,
      version: "snapchat-insights-v7-safe-fields-active-first",
      account_id: accountId,
      level,
      date_preset,
      start_time,
      end_time,
      currency: "USD",

      total_entities_available: allEntities.length,
      loaded_limit: limit,
      loaded_rows: rows.length,
      partial_data: rows.length < allEntities.length,
      rate_limited: rateLimited,
      active_first: true,

      summary,
      rows,
      errors
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Snapchat insights failed"
      },
      { status: 500 }
    );
  }
}
