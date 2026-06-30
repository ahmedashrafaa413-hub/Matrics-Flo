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
