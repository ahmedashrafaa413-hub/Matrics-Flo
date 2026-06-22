import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

const FIELDS = [
  "impressions",
  "swipes",
  "spend",
  "conversion_purchases",
  "conversion_purchases_value",
  "conversion_add_cart",
  "conversion_add_billing",
  "conversion_view_content",
  "quartile_1",
  "quartile_2",
  "quartile_3",
  "view_completion",
  "screen_time_millis"
].join(",");

const memoryCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

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

function cacheGet(key) {
  const cached = memoryCache.get(key);

  if (!cached) return null;

  if (Date.now() - cached.ts > CACHE_TTL) {
    memoryCache.delete(key);
    return null;
  }

  return cached.data;
}

function cacheSet(key, data) {
  memoryCache.set(key, {
    ts: Date.now(),
    data
  });
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

  const nowHour = today.h;

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
  } else if (preset === "this_month") {
    startDay = { ...today, d: 1 };
    endDay = today;
    endHour = nowHour;
  } else if (preset === "last_90d") {
    startDay = shiftDay(-89);
    endDay = today;
    endHour = nowHour;
  } else if (preset === "maximum") {
    startDay = shiftDay(-1095);
    endDay = today;
    endHour = nowHour;
  } else {
    startDay = shiftDay(-29);
    endDay = today;
    endHour = nowHour;
  }

  if (preset === "today" && endHour === 0) {
    endHour = 1;
  }

  return {
    startTime: stamp(startDay, 0),
    endTime: stamp(endDay, endHour)
  };
}

async function snapFetch(url, token, retries = 3) {
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
      await sleep(1500 * (attempt + 1));
      continue;
    }

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
        raw: text.slice(0, 400)
      };
    }
  }

  return {
    ok: false,
    status: 429,
    data: null,
    raw: "Snapchat rate limit after retries"
  };
}

function buildMetrics(stats = {}) {
  const spend = micros(stats.spend);
  const revenue = micros(stats.conversion_purchases_value);
  const purchases = safeNum(stats.conversion_purchases);
  const addToCart = safeNum(stats.conversion_add_cart);
  const initiateCheckout = safeNum(stats.conversion_add_billing);
  const viewContent = safeNum(stats.conversion_view_content);

  const impressions = safeNum(stats.impressions);
  const swipes = safeNum(stats.swipes);

  const quartile1 = safeNum(stats.quartile_1);
  const quartile2 = safeNum(stats.quartile_2);
  const quartile3 = safeNum(stats.quartile_3);
  const viewCompletion = safeNum(stats.view_completion);
  const screenTimeMillis = safeNum(stats.screen_time_millis);

  const videoViews = quartile1 || viewCompletion || 0;

  return {
    currency: "USD",

    spend: fix2(spend),
    revenue: fix2(revenue),
    purchase_value: fix2(revenue),

    purchases,
    add_to_cart: addToCart,
    initiate_checkout: initiateCheckout,
    view_content: viewContent,

    impressions,
    swipes,
    clicks: swipes,

    video_views: videoViews,
    quartile_1: quartile1,
    quartile_2: quartile2,
    quartile_3: quartile3,
    view_completion: viewCompletion,
    screen_time_sec: fix2(screenTimeMillis / 1000),

    roas: fix2(safeDivide(revenue, spend)),
    cpa: fix2(safeDivide(spend, purchases)),
    cost_per_atc: fix2(safeDivide(spend, addToCart)),

    ctr: fix2(safeDivide(swipes, impressions) * 100),
    cpc: fix2(safeDivide(spend, swipes)),
    cpm: fix2(safeDivide(spend, impressions) * 1000),

    hook_rate: fix2(safeDivide(quartile1, impressions) * 100),
    hold_rate: fix2(safeDivide(quartile3, quartile1) * 100),
    completion_rate: fix2(safeDivide(viewCompletion, impressions) * 100),
    video_view_rate: fix2(safeDivide(videoViews, impressions) * 100)
  };
}

async function fetchAccountSummary({
  accountId,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow
}) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}` +
    `&view_attribution_window=${viewWindow}`;

  const result = await snapFetch(url, token);

  if (!result.ok) {
    return {
      ok: false,
      error: result.data || result.raw,
      status: result.status,
      summary: buildMetrics({})
    };
  }

  const stats = result.data?.total_stats?.[0]?.total_stat?.stats || {};

  return {
    ok: true,
    summary: buildMetrics(stats)
  };
}

async function fetchBreakdown({
  accountId,
  level,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow
}) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL` +
    `&breakdown=${level}` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}` +
    `&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}` +
    `&view_attribution_window=${viewWindow}` +
    `&limit=1000`;

  const statsById = {};
  let pages = 0;
  let nextUrl = url;

  while (nextUrl && pages < 10) {
    const result = await snapFetch(nextUrl, token);

    if (!result.ok) {
      if (pages === 0) {
        return {
          ok: false,
          statsById: {},
          error: result.data || result.raw,
          pages_fetched: pages
        };
      }

      break;
    }

    const items =
      result.data?.total_stats?.[0]?.breakdown_stats?.[level] || [];

    for (const item of items) {
      if (item?.id) {
        statsById[item.id] = item.stats || {};
      }
    }

    nextUrl =
      result.data?.total_stats?.[0]?.paging?.next_link ||
      result.data?.paging?.next_link ||
      null;

    pages += 1;
  }

  return {
    ok: true,
    statsById,
    pages_fetched: pages
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

async function fetchEntities({ accountId, level, token }) {
  const pathMap = {
    campaign: "campaigns",
    adsquad: "adsquads",
    ad: "ads"
  };

  const path = pathMap[level] || "campaigns";

  const allRaw = [];
  let nextUrl = `${BASE}/adaccounts/${accountId}/${path}?limit=1000`;
  let pages = 0;

  while (nextUrl && pages < 15) {
    const result = await snapFetch(nextUrl, token);

    if (!result.ok) {
      if (pages === 0) {
        return {
          ok: false,
          status: result.status,
          error: result.data || result.raw,
          entities: [],
          pages_fetched: pages
        };
      }

      break;
    }

    allRaw.push(...(result.data?.[path] || []));
    nextUrl = result.data?.paging?.next_link || null;
    pages += 1;
  }

  let entities = [];

  if (level === "campaign") {
    entities = allRaw.map((item) => {
      const campaign = item.campaign || item;

      return {
        id: campaign.id,
        name: campaign.name || "Unnamed",
        campaign_name: campaign.name || "Unnamed",
        status: normalizeStatus(campaign),
        raw_status: campaign.status || campaign.effective_status || "",
        level: "campaign",
        updated_at: campaign.updated_at || campaign.created_at || null
      };
    });
  }

  if (level === "adsquad") {
    entities = allRaw.map((item) => {
      const adSquad = item.adsquad || item;

      return {
        id: adSquad.id,
        name: adSquad.name || "Unnamed",
        adsquad_name: adSquad.name || "Unnamed",
        campaign_id: adSquad.campaign_id || "",
        status: normalizeStatus(adSquad),
        raw_status: adSquad.status || adSquad.effective_status || "",
        level: "adsquad",
        updated_at: adSquad.updated_at || adSquad.created_at || null
      };
    });
  }

  if (level === "ad") {
    entities = allRaw.map((item) => {
      const ad = item.ad || item;

      return {
        id: ad.id,
        name: ad.name || "Unnamed",
        ad_name: ad.name || "Unnamed",
        adsquad_id: ad.ad_squad_id || ad.adsquad_id || "",
        status: normalizeStatus(ad),
        raw_status: ad.status || ad.effective_status || "",
        level: "ad",
        updated_at: ad.updated_at || ad.created_at || null
      };
    });
  }

  return {
    ok: true,
    entities,
    pages_fetched: pages
  };
}

function buildSummaryFromRows(rows) {
  const total = rows.reduce(
    (acc, row) => {
      acc.spend += safeNum(row.spend);
      acc.revenue += safeNum(row.revenue);
      acc.purchases += safeNum(row.purchases);
      acc.add_to_cart += safeNum(row.add_to_cart);
      acc.initiate_checkout += safeNum(row.initiate_checkout);
      acc.impressions += safeNum(row.impressions);
      acc.swipes += safeNum(row.swipes);
      acc.video_views += safeNum(row.video_views);
      acc.quartile_1 += safeNum(row.quartile_1);
      acc.quartile_3 += safeNum(row.quartile_3);
      acc.view_completion += safeNum(row.view_completion);

      return acc;
    },
    {
      spend: 0,
      revenue: 0,
      purchases: 0,
      add_to_cart: 0,
      initiate_checkout: 0,
      impressions: 0,
      swipes: 0,
      video_views: 0,
      quartile_1: 0,
      quartile_3: 0,
      view_completion: 0
    }
  );

  return {
    currency: "USD",

    spend: fix2(total.spend),
    revenue: fix2(total.revenue),
    purchase_value: fix2(total.revenue),

    purchases: total.purchases,
    add_to_cart: total.add_to_cart,
    initiate_checkout: total.initiate_checkout,

    impressions: total.impressions,
    swipes: total.swipes,
    clicks: total.swipes,
    video_views: total.video_views,

    quartile_1: total.quartile_1,
    quartile_3: total.quartile_3,
    view_completion: total.view_completion,

    roas: fix2(safeDivide(total.revenue, total.spend)),
    cpa: fix2(safeDivide(total.spend, total.purchases)),
    cost_per_atc: fix2(safeDivide(total.spend, total.add_to_cart)),

    ctr: fix2(safeDivide(total.swipes, total.impressions) * 100),
    cpc: fix2(safeDivide(total.spend, total.swipes)),
    cpm: fix2(safeDivide(total.spend, total.impressions) * 1000),

    hook_rate: fix2(safeDivide(total.quartile_1, total.impressions) * 100),
    hold_rate: fix2(safeDivide(total.quartile_3, total.quartile_1) * 100),
    completion_rate: fix2(
      safeDivide(total.view_completion, total.impressions) * 100
    ),
    video_view_rate: fix2(
      safeDivide(total.video_views, total.impressions) * 100
    )
  };
}

const VALID_SWIPE_WINDOWS = ["1_DAY", "7_DAY", "28_DAY"];
const VALID_VIEW_WINDOWS = ["1_HOUR", "3_HOUR", "6_HOUR", "1_DAY", "7_DAY", "28_DAY"];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const level = normalizeLevel(searchParams.get("level") || "campaign");
    const datePreset = searchParams.get("date_preset") || "last_30d";
    const force = searchParams.get("force") === "1";

    const requestedLimit = Number(searchParams.get("limit") || 50);
    const limit = Math.min(Math.max(requestedLimit, 1), 1000);

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

    const cacheKey = [
      "snapchat-insights-workspace-v1",
      accountId,
      level,
      datePreset,
      swipeWindow,
      viewWindow,
      limit
    ].join(":");

    if (!force) {
      const cached = cacheGet(cacheKey);

      if (cached) {
        return NextResponse.json({
          ...cached,
          cached: true
        });
      }
    }

    const token = await getSnapchatToken(request, accountId);

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Not connected to Snapchat for this workspace/account. Please reconnect Snapchat.",
          provider: "Snapchat Ads",
          account_id: accountId
        },
        { status: 401 }
      );
    }

    const { startTime, endTime } = getDateRange(datePreset);

    const accountSummaryResult = await fetchAccountSummary({
      accountId,
      token,
      startTime,
      endTime,
      swipeWindow,
      viewWindow
    });

    if (level === "overview") {
      const payload = {
        success: true,
        provider: "Snapchat Ads",
        version: "snapchat-insights-workspace-v1",
        account_id: accountId,
        level,
        date_preset: datePreset,
        timezone: "Asia/Riyadh",
        currency: "USD",
        start_time: startTime,
        end_time: endTime,
        attribution: {
          swipe_window: swipeWindow,
          view_window: viewWindow
        },
        total_entities_available: 0,
        loaded_limit: 0,
        loaded_rows: 0,
        partial_data: false,
        summary_source: "account_summary",
        summary: accountSummaryResult.summary,
        rows: [],
        data: [],
        errors: accountSummaryResult.ok
          ? []
          : [
              {
                source: "account_summary",
                error: accountSummaryResult.error,
                status: accountSummaryResult.status
              }
            ]
      };

      cacheSet(cacheKey, payload);
      return NextResponse.json(payload);
    }

    const [entitiesResult, breakdownResult] = await Promise.all([
      fetchEntities({
        accountId,
        level,
        token
      }),
      fetchBreakdown({
        accountId,
        level,
        token,
        startTime,
        endTime,
        swipeWindow,
        viewWindow
      })
    ]);

    if (!entitiesResult.ok) {
      return NextResponse.json(
        {
          success: false,
          provider: "Snapchat Ads",
          error: entitiesResult.error,
          status: entitiesResult.status,
          account_id: accountId,
          level,
          date_preset: datePreset,
          debug: {
            startTime,
            endTime,
            swipeWindow,
            viewWindow
          }
        },
        { status: entitiesResult.status || 500 }
      );
    }

    const allEntities = entitiesResult.entities || [];
    let rows = [];

    if (breakdownResult.ok && Object.keys(breakdownResult.statsById).length > 0) {
      rows = allEntities
        .map((entity) => ({
          ...entity,
          ...buildMetrics(breakdownResult.statsById[entity.id] || {})
        }))
        .filter(
          (row) =>
            safeNum(row.spend) > 0.001 ||
            safeNum(row.revenue) > 0.001 ||
            safeNum(row.purchases) > 0 ||
            safeNum(row.impressions) > 0 ||
            safeNum(row.swipes) > 0
        )
        .sort((a, b) => safeNum(b.spend) - safeNum(a.spend));
    } else {
      rows = allEntities
        .map((entity) => ({
          ...entity,
          ...buildMetrics({})
        }))
        .slice(0, limit);
    }

    const limitedRows = rows.slice(0, limit);

    const summary = accountSummaryResult.ok
      ? accountSummaryResult.summary
      : buildSummaryFromRows(limitedRows);

    const payload = {
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-insights-workspace-v1",
      account_id: accountId,
      level,
      date_preset: datePreset,
      timezone: "Asia/Riyadh",
      currency: "USD",
      start_time: startTime,
      end_time: endTime,
      attribution: {
        swipe_window: swipeWindow,
        view_window: viewWindow
      },
      total_entities_available: allEntities.length,
      loaded_limit: limit,
      loaded_rows: limitedRows.length,
      partial_data: limitedRows.length < rows.length,
      summary_source: accountSummaryResult.ok ? "account_summary" : "rows",
      summary,
      rows: limitedRows,
      data: limitedRows,
      errors: [
        ...(accountSummaryResult.ok
          ? []
          : [
              {
                source: "account_summary",
                error: accountSummaryResult.error,
                status: accountSummaryResult.status
              }
            ]),
        ...(breakdownResult.ok
          ? []
          : [
              {
                source: "breakdown",
                error: breakdownResult.error
              }
            ])
      ]
    };

    cacheSet(cacheKey, payload);

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "Snapchat Ads",
        error: error.message || "Failed to load Snapchat insights",
        version: "snapchat-insights-workspace-v1"
      },
      { status: error.status || 500 }
    );
  }
}
