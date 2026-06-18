import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const SNAPCHAT_API_BASE = "https://adsapi.snapchat.com/v1";

const SAFE_FIELDS = [
  "impressions",
  "spend",
  "swipes",
  "conversion_purchases",
  "conversion_purchases_value",
  "video_views"
].join(",");

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 120;
const DEFAULT_CANDIDATE_LIMIT = 160;
const MAX_CANDIDATE_LIMIT = 300;
const CONCURRENCY = 8;

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

function clamp(value, fallback, max) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function normalizeLevel(levelValue) {
  const level = String(levelValue || "campaign").toLowerCase();

  if (level === "overview" || level === "campaign" || level === "campaigns") {
    return {
      level: "campaign",
      listPath: "campaigns",
      statsPath: "campaigns",
      responseKeys: ["campaigns", "campaign"]
    };
  }

  if (
    level === "ad_squad" ||
    level === "ad_squads" ||
    level === "adsquad" ||
    level === "adsquads" ||
    level === "adset" ||
    level === "adsets"
  ) {
    return {
      level: "ad_squad",
      listPath: "adsquads",
      statsPath: "adsquads",
      responseKeys: ["adsquads", "ad_squads", "adsquad", "ad_squad"]
    };
  }

  if (level === "ad" || level === "ads") {
    return {
      level: "ad",
      listPath: "ads",
      statsPath: "ads",
      responseKeys: ["ads", "ad"]
    };
  }

  return null;
}

function getRiyadhDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value,
    month: parts.find((part) => part.type === "month")?.value,
    day: parts.find((part) => part.type === "day")?.value
  };
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function riyadhStartOfDay(date) {
  const { year, month, day } = getRiyadhDateParts(date);
  return `${year}-${month}-${day}T00:00:00.000+03:00`;
}

function riyadhEndOfDay(date) {
  const { year, month, day } = getRiyadhDateParts(date);
  return `${year}-${month}-${day}T23:00:00.000+03:00`;
}

function getDateRange(datePresetValue) {
  const now = new Date();
  const datePreset = String(datePresetValue || "last_30d").toLowerCase();

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

async function snapFetch(path, token) {
  const response = await fetch(`${SNAPCHAT_API_BASE}${path}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: `Snapchat API did not return JSON. Response starts with: ${text.slice(
        0,
        120
      )}`
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data,
      error:
        data?.request_status ||
        data?.debug_message ||
        data?.message ||
        `Snapchat API failed with status ${response.status}`
    };
  }

  return {
    ok: true,
    status: response.status,
    data,
    error: null
  };
}

function extractList(data, keys) {
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }

  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;

  return [];
}

function unwrapEntity(item, config) {
  for (const key of config.responseKeys) {
    if (item?.[key]) return item[key];
  }

  return item;
}

function getEntityId(entity, level) {
  if (!entity) return "";

  if (level === "campaign") {
    return entity.id || entity.campaign_id || "";
  }

  if (level === "ad_squad") {
    return entity.id || entity.adsquad_id || entity.ad_squad_id || "";
  }

  if (level === "ad") {
    return entity.id || entity.ad_id || "";
  }

  return entity.id || "";
}

function getEntityName(entity, level) {
  if (!entity) return "Untitled";

  return (
    entity.name ||
    entity.campaign_name ||
    entity.adsquad_name ||
    entity.ad_squad_name ||
    entity.ad_name ||
    `Untitled ${level}`
  );
}

function getRawStatus(entity) {
  return (
    entity?.delivery_status ||
    entity?.effective_status ||
    entity?.configured_status ||
    entity?.status ||
    ""
  );
}

function getEntityStatus(entity) {
  const raw = getRawStatus(entity);
  const status = String(raw || "").toUpperCase();

  if (
    status.includes("INVALID") ||
    status.includes("REJECTED") ||
    status.includes("NOT_DELIVERING")
  ) {
    return "ISSUE";
  }

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

  return raw || "UNKNOWN";
}

function getUpdatedAt(entity) {
  return entity?.updated_at || entity?.created_at || entity?.start_time || "";
}

function sortEntitiesForCandidateScan(a, b) {
  const aStatus = getEntityStatus(a);
  const bStatus = getEntityStatus(b);

  const aPriority = aStatus === "ACTIVE" ? 3 : aStatus === "ISSUE" ? 1 : 2;
  const bPriority = bStatus === "ACTIVE" ? 3 : bStatus === "ISSUE" ? 1 : 2;

  if (aPriority !== bPriority) return bPriority - aPriority;

  const aTime = new Date(getUpdatedAt(a)).getTime() || 0;
  const bTime = new Date(getUpdatedAt(b)).getTime() || 0;

  return bTime - aTime;
}

function extractStats(data) {
  const root =
    data?.timeseries_stats ||
    data?.total_stats ||
    data?.lifetime_stats ||
    data?.stats ||
    data;

  if (Array.isArray(root)) {
    const first = root[0] || {};
    return (
      first?.timeseries_stat?.stats ||
      first?.total_stat?.stats ||
      first?.lifetime_stat?.stats ||
      first?.stats ||
      first ||
      {}
    );
  }

  if (root?.timeseries_stat?.stats) return root.timeseries_stat.stats;
  if (root?.total_stat?.stats) return root.total_stat.stats;
  if (root?.lifetime_stat?.stats) return root.lifetime_stat.stats;
  if (root?.stats) return root.stats;

  return root || {};
}

function normalizeStats(stats) {
  const spend = moneyFromMicros(stats.spend);
  const revenue = moneyFromMicros(stats.conversion_purchases_value);

  const impressions = safeNumber(stats.impressions);
  const swipes = safeNumber(stats.swipes);
  const purchases = safeNumber(stats.conversion_purchases);
  const videoViews = safeNumber(stats.video_views);

  return {
    currency: "USD",
    spend,
    revenue,
    purchase_value: revenue,
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
    purchase_value: revenue,
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

function sortRowsByPerformance(a, b) {
  const aScore =
    safeNumber(a.spend) * 1000000 +
    safeNumber(a.revenue) * 1000 +
    safeNumber(a.purchases) * 100 +
    safeNumber(a.impressions);

  const bScore =
    safeNumber(b.spend) * 1000000 +
    safeNumber(b.revenue) * 1000 +
    safeNumber(b.purchases) * 100 +
    safeNumber(b.impressions);

  if (aScore !== bScore) return bScore - aScore;

  const aActive = a.status === "ACTIVE";
  const bActive = b.status === "ACTIVE";

  if (aActive && !bActive) return -1;
  if (!aActive && bActive) return 1;

  return 0;
}

async function runWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

async function getAccountLevelStats({ accountId, token, startTime, endTime }) {
  const params = new URLSearchParams();
  params.set("granularity", "TOTAL");
  params.set("fields", SAFE_FIELDS);
  params.set("start_time", startTime);
  params.set("end_time", endTime);

  const result = await snapFetch(
    `/adaccounts/${encodeURIComponent(accountId)}/stats?${params.toString()}`,
    token
  );

  if (!result.ok) return null;

  const stats = extractStats(result.data);
  return normalizeStats(stats);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const accountId = searchParams.get("account_id") || "";
  const levelParam = searchParams.get("level") || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_30d";
  const limit = clamp(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const candidateLimit = clamp(
    searchParams.get("candidate_limit"),
    Math.max(DEFAULT_CANDIDATE_LIMIT, limit),
    MAX_CANDIDATE_LIMIT
  );

  if (!accountId) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing account_id"
      },
      { status: 400 }
    );
  }

  const config = normalizeLevel(levelParam);

  if (!config) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid level. Use campaign, ad_squad, or ad."
      },
      { status: 400 }
    );
  }

  try {
    const token = await getSnapchatToken();

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing Snapchat access token. Please reconnect Snapchat."
        },
        { status: 401 }
      );
    }

    const { start_time, end_time } = getDateRange(datePreset);

    const listResult = await snapFetch(
      `/adaccounts/${encodeURIComponent(accountId)}/${config.listPath}`,
      token
    );

    if (!listResult.ok) {
      return NextResponse.json(
        {
          success: false,
          error: listResult.error,
          status: listResult.status,
          raw: listResult.data
        },
        { status: listResult.status || 500 }
      );
    }

    const allEntities = extractList(listResult.data, [
      config.listPath,
      ...config.responseKeys,
      "data"
    ])
      .map((item) => unwrapEntity(item, config))
      .filter((entity) => getEntityId(entity, config.level))
      .sort(sortEntitiesForCandidateScan);

    const selectedCandidates = allEntities.slice(0, candidateLimit);

    let rateLimited = false;

    const statResults = await runWithConcurrency(
      selectedCandidates,
      CONCURRENCY,
      async (entity) => {
        const entityId = getEntityId(entity, config.level);

        const params = new URLSearchParams();
        params.set("granularity", "TOTAL");
        params.set("fields", SAFE_FIELDS);
        params.set("start_time", start_time);
        params.set("end_time", end_time);

        const statsResult = await snapFetch(
          `/${config.statsPath}/${encodeURIComponent(
            entityId
          )}/stats?${params.toString()}`,
          token
        );

        if (!statsResult.ok) {
          if (statsResult.status === 429) rateLimited = true;

          return {
            row: null,
            error: {
              id: entityId,
              name: getEntityName(entity, config.level),
              status: statsResult.status,
              error: statsResult.error
            }
          };
        }

        const stats = extractStats(statsResult.data);

        return {
          row: {
            id: entityId,
            name: getEntityName(entity, config.level),
            status: getEntityStatus(entity),
            raw_status: getRawStatus(entity),
            level: config.level,
            updated_at: getUpdatedAt(entity),
            ...normalizeStats(stats)
          },
          error: null
        };
      }
    );

    const rowsWithStats = statResults
      .map((item) => item?.row)
      .filter(Boolean)
      .sort(sortRowsByPerformance);

    const rows = rowsWithStats.slice(0, limit);

    const errors = statResults.map((item) => item?.error).filter(Boolean);

    const accountSummary = await getAccountLevelStats({
      accountId,
      token,
      startTime: start_time,
      endTime: end_time
    });

    const summary = accountSummary || buildSummary(rowsWithStats);

    return NextResponse.json({
      success: true,
      version: "snapchat-insights-v9-concurrent-top-performing",
      account_id: accountId,
      level: config.level,
      date_preset: datePreset,
      timezone: "Asia/Riyadh",
      start_time,
      end_time,
      currency: "USD",
      fields: SAFE_FIELDS.split(","),
      total_entities_available: allEntities.length,
      scanned_entities: selectedCandidates.length,
      loaded_limit: limit,
      loaded_rows: rows.length,
      partial_data: rows.length < allEntities.length,
      summary_source: accountSummary ? "account_stats" : "scanned_entities",
      rate_limited: rateLimited,
      active_first: false,
      sorted_by: "spend_revenue_purchases",
      summary,
      rows,
      data: rows,
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
