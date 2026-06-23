import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

const SAFE_FIELDS = [
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

function normalizeLevel(level) {
  const raw = String(level || "campaign").toLowerCase();

  if (raw === "overview" || raw === "account") return "overview";
  if (raw === "campaign" || raw === "campaigns") return "campaign";
  if (raw === "adsquad" || raw === "ad_squad" || raw === "ad_squads") {
    return "adsquad";
  }
  if (raw === "ad" || raw === "ads") return "ad";

  return "campaign";
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
      ...today,
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
        error: `Snapchat response is not JSON: ${text.slice(0, 200)}`
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

async function fetchEntityStats({
  entityId,
  level,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow
}) {
  const pathMap = {
    campaign: "campaigns",
    adsquad: "adsquads",
    ad: "ads"
  };

  const path = pathMap[level] || "campaigns";

  const url =
    `${BASE}/${path}/${encodeURIComponent(entityId)}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(SAFE_FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${encodeURIComponent(swipeWindow)}` +
    `&view_attribution_window=${encodeURIComponent(viewWindow)}`;

  const result = await snapFetch(url, token);

  if (!result.ok) {
    return {
      ok: false,
      stats: {},
      error: result.error,
      status: result.status
    };
  }

  return {
    ok: true,
    stats: extractTotalStats(result.data),
    error: null,
    status: result.status
  };
}

async function fetchEntities({ accountId, level, token }) {
  const pathMap = {
    campaign: "campaigns",
    adsquad: "adsquads",
    ad: "ads"
  };

  const path = pathMap[level] || "campaigns";

  const entities = [];
  let nextUrl = `${BASE}/adaccounts/${encodeURIComponent(accountId)}/${path}?limit=1000`;
  let pages = 0;

  while (nextUrl && pages < 15) {
    const result = await snapFetch(nextUrl, token);

    if (!result.ok) {
      if (pages === 0) {
        return {
          ok: false,
          status: result.status,
          error: result.error,
          entities: [],
          pages_fetched: pages
        };
      }

      break;
    }

    const rawItems = result.data?.[path] || [];

    for (const item of rawItems) {
      if (level === "campaign") {
        const campaign = item.campaign || item;

        if (!campaign?.id) continue;

        entities.push({
          id: campaign.id,
          name: campaign.name || "Unnamed Campaign",
          campaign_name: campaign.name || "Unnamed Campaign",
          status: normalizeStatus(campaign),
          raw_status: campaign.status || campaign.effective_status || "",
          level: "campaign",
          updated_at: campaign.updated_at || campaign.created_at || null
        });
      }

      if (level === "adsquad") {
        const adSquad = item.adsquad || item;

        if (!adSquad?.id) continue;

        entities.push({
          id: adSquad.id,
          name: adSquad.name || "Unnamed Ad Squad",
          adsquad_name: adSquad.name || "Unnamed Ad Squad",
          campaign_id: adSquad.campaign_id || "",
          status: normalizeStatus(adSquad),
          raw_status: adSquad.status || adSquad.effective_status || "",
          level: "adsquad",
          updated_at: adSquad.updated_at || adSquad.created_at || null
        });
      }

      if (level === "ad") {
        const ad = item.ad || item;

        if (!ad?.id) continue;

        entities.push({
          id: ad.id,
          name: ad.name || "Unnamed Ad",
          ad_name: ad.name || "Unnamed Ad",
          adsquad_id: ad.ad_squad_id || ad.adsquad_id || "",
          status: normalizeStatus(ad),
          raw_status: ad.status || ad.effective_status || "",
          level: "ad",
          updated_at: ad.updated_at || ad.created_at || null
        });
      }
    }

    nextUrl = result.data?.paging?.next_link || null;
    pages += 1;
  }

  return {
    ok: true,
    entities,
    pages_fetched: pages
  };
}

function hasMeaningfulMetrics(row) {
  return (
    safeNum(row.spend) > 0.001 ||
    safeNum(row.revenue) > 0.001 ||
    safeNum(row.purchases) > 0 ||
    safeNum(row.impressions) > 0 ||
    safeNum(row.swipes) > 0 ||
    safeNum(row.video_views) > 0
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

async function buildRowsWithStats({
  entities,
  level,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow,
  candidateLimit
}) {
  const candidates = entities.slice(0, candidateLimit);

  const rows = await mapWithConcurrency(candidates, 6, async (entity) => {
    const statsResult = await fetchEntityStats({
      entityId: entity.id,
      level,
      token,
      startTime,
      endTime,
      swipeWindow,
      viewWindow
    });

    return {
      ...entity,
      ...buildMetrics(statsResult.stats || {}),
      stats_error: statsResult.ok ? null : statsResult.error
    };
  });

  return rows
    .filter(hasMeaningfulMetrics)
    .sort((a, b) => safeNum(b.spend) - safeNum(a.spend));
}

function buildSummaryFromRows(rows) {
  const total = rows.reduce(
    (acc, row) => {
      acc.spend += safeNum(row.spend);
      acc.revenue += safeNum(row.revenue);
      acc.purchases += safeNum(row.purchases);
      acc.impressions += safeNum(row.impressions);
      acc.swipes += safeNum(row.swipes);
      acc.video_views += safeNum(row.video_views);
      return acc;
    },
    {
      spend: 0,
      revenue: 0,
      purchases: 0,
      impressions: 0,
      swipes: 0,
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
    swipes: total.swipes,
    clicks: total.swipes,
    video_views: total.video_views,
    roas: fix2(safeDivide(total.revenue, total.spend)),
    cpa: fix2(safeDivide(total.spend, total.purchases)),
    ctr: fix2(safeDivide(total.swipes, total.impressions) * 100),
    cpc: fix2(safeDivide(total.spend, total.swipes)),
    cpm: fix2(safeDivide(total.spend, total.impressions) * 1000),
    video_view_rate: fix2(safeDivide(total.video_views, total.impressions) * 100)
  };
}

function normalizeMetricRow({
  workspaceId,
  accountId,
  metricDate,
  level,
  row,
  datePreset,
  sourceMeta
}) {
  return {
    workspace_id: workspaceId,
    connection_id: null,
    provider: "snapchat",
    account_id: accountId,

    entity_level: level,
    entity_id: row.id || accountId,
    entity_name:
      row.name ||
      row.campaign_name ||
      row.adsquad_name ||
      row.ad_name ||
      "Snapchat",

    metric_date: metricDate,
    currency: row.currency || "USD",

    spend: safeNum(row.spend),
    revenue: safeNum(row.revenue || row.purchase_value),
    purchases: safeNum(row.purchases),
    impressions: safeNum(row.impressions),
    clicks: safeNum(row.clicks || row.swipes),
    video_views: safeNum(row.video_views),

    raw: {
      ...row,
      date_preset: datePreset,
      synced_from: "snapchat_sync_direct",
      source_meta: sourceMeta
    },

    updated_at: new Date().toISOString()
  };
}

async function deleteOldCache({
  admin,
  workspaceId,
  accountId,
  metricDate,
  datePreset
}) {
  await admin
    .from("platform_daily_metrics")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("provider", "snapchat")
    .eq("account_id", accountId)
    .eq("metric_date", metricDate)
    .filter("raw->>date_preset", "eq", datePreset);
}

async function insertMetrics({ admin, rows }) {
  if (!rows.length) {
    return {
      inserted: 0
    };
  }

  const { error } = await admin.from("platform_daily_metrics").insert(rows);

  if (error) {
    throw new Error(error.message);
  }

  return {
    inserted: rows.length
  };
}

const VALID_SWIPE_WINDOWS = ["1_DAY", "7_DAY", "28_DAY"];
const VALID_VIEW_WINDOWS = [
  "1_HOUR",
  "3_HOUR",
  "6_HOUR",
  "1_DAY",
  "7_DAY",
  "28_DAY"
];

export async function GET(request) {
  return syncSnapchat(request);
}

export async function POST(request) {
  return syncSnapchat(request);
}

async function syncSnapchat(request) {
  const startedAt = new Date().toISOString();

  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "last_30d";

    const levelsParam = searchParams.get("levels") || "overview,campaign";
    const levels = levelsParam
      .split(",")
      .map((item) => normalizeLevel(item.trim()))
      .filter(Boolean);

    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") || 20), 1),
      100
    );

    const requestedCandidateLimit = Number(
      searchParams.get("candidate_limit") ||
        searchParams.get("scan_limit") ||
        160
    );

    const candidateLimit = Math.min(
      Math.max(requestedCandidateLimit, limit),
      300
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
          version: "snapchat-sync-direct-to-supabase-v2",
          error:
            "Snapchat token not found in platform_connections for this workspace/account. Please reconnect Snapchat and open /api/snapchat/accounts once."
        },
        { status: 401 }
      );
    }

    const admin = createSupabaseAdminClient();

    const workspaceId = workspace.id;
    const metricDate = todayDate();
    const { startTime, endTime } = getDateRange(datePreset);

    await deleteOldCache({
      admin,
      workspaceId,
      accountId,
      metricDate,
      datePreset
    });

    const insertedRows = [];
    const syncResults = [];

    for (const level of levels) {
      const actualLevelForData = level === "overview" ? "campaign" : level;

      const entitiesResult = await fetchEntities({
        accountId,
        level: actualLevelForData,
        token
      });

      if (!entitiesResult.ok) {
        syncResults.push({
          level,
          success: false,
          error: entitiesResult.error,
          status: entitiesResult.status
        });
        continue;
      }

      const rowsWithStats = await buildRowsWithStats({
        entities: entitiesResult.entities || [],
        level: actualLevelForData,
        token,
        startTime,
        endTime,
        swipeWindow,
        viewWindow,
        candidateLimit
      });

      const summary = buildSummaryFromRows(rowsWithStats);

      const sourceMeta = {
        version: "snapchat-sync-direct-to-supabase-v2",
        start_time: startTime,
        end_time: endTime,
        attribution: {
          swipe_window: swipeWindow,
          view_window: viewWindow
        },
        summary_source: "entity_stats",
        scanned_entities: Math.min(
          entitiesResult.entities.length,
          candidateLimit
        ),
        total_entities_available: entitiesResult.entities.length,
        partial_data: entitiesResult.entities.length > candidateLimit
      };

      if (level === "overview") {
        insertedRows.push(
          normalizeMetricRow({
            workspaceId,
            accountId,
            metricDate,
            level: "account",
            row: {
              id: accountId,
              name: "Snapchat Account Overview",
              ...summary
            },
            datePreset,
            sourceMeta
          })
        );
      } else {
        const limitedRows = rowsWithStats.slice(0, limit);

        for (const row of limitedRows) {
          insertedRows.push(
            normalizeMetricRow({
              workspaceId,
              accountId,
              metricDate,
              level,
              row,
              datePreset,
              sourceMeta
            })
          );
        }
      }

      syncResults.push({
        level,
        actual_level_for_data: actualLevelForData,
        success: true,
        total_entities_available: entitiesResult.entities.length,
        scanned_entities: Math.min(
          entitiesResult.entities.length,
          candidateLimit
        ),
        rows_with_metrics: rowsWithStats.length,
        summary
      });
    }

    const insertResult = await insertMetrics({
      admin,
      rows: insertedRows
    });

    const finishedAt = new Date().toISOString();

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-sync-direct-to-supabase-v2",
      workspace_id: workspaceId,
      user_id: user.id,
      account_id: accountId,
      date_preset: datePreset,
      metric_date: metricDate,
      levels,
      inserted_rows: insertResult.inserted,
      started_at: startedAt,
      finished_at: finishedAt,
      results: syncResults
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "Snapchat Ads",
        version: "snapchat-sync-direct-to-supabase-v2",
        error: error.message || "Snapchat sync failed"
      },
      { status: error.status || 500 }
    );
  }
}
