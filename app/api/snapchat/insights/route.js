import { getSnapchatToken } from "../../../../lib/snapchatToken";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function safeDivide(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);
  return y ? x / y : 0;
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
      start: daysAgo(365),
      end: today
    }
  };

  const range = presets[datePreset] || presets.last_30d;

  return {
    start_time: `${range.start}T00:00:00.000Z`,
    end_time: toEnd(range.end)
  };
}

async function snap(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data?.request_status ||
        data?.message ||
        data?.debug_message ||
        `Snapchat API error: ${res.status}`
    );
  }

  return data;
}

const STATS_FIELDS = [
  "impressions",
  "swipes",
  "swipe_up_rate",
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

async function fetchStats(entityType, ids, dateParams, token) {
  const statsMap = {};
  const chunkSize = 10;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);

    await Promise.allSettled(
      chunk.map(async (id) => {
        try {
          const url =
            `${BASE}/${entityType}/${id}/stats` +
            `?granularity=LIFETIME` +
            `&fields=${STATS_FIELDS}` +
            `&start_time=${encodeURIComponent(dateParams.start_time)}` +
            `&end_time=${encodeURIComponent(dateParams.end_time)}`;

          const res = await fetch(url, {
            headers: {
              Authorization: `Bearer ${token}`
            },
            cache: "no-store"
          });

          const data = await res.json();

          if (!statsMap.__debug__ && data) {
            statsMap.__debug__ = {
              entityType,
              id,
              status: res.status,
              url: url.replace(/Bearer .+/, "Bearer TOKEN_HIDDEN"),
              response: data
            };
          }

          if (!res.ok) {
            statsMap[id] = {};
            return;
          }

          statsMap[id] =
            data.total_stats?.[0]?.total_stat?.stats ||
            data.timeseries_stats?.[0]?.timeseries_stat?.timeseries?.[0]?.stats ||
            {};
        } catch (error) {
          statsMap[id] = {};
        }
      })
    );
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

  const v25 = Number(stats.view_completion_1_quarter || 0);
  const v50 = Number(stats.view_completion_2_quarter || 0);
  const v75 = Number(stats.view_completion_3_quarter || 0);
  const v100 = Number(stats.view_completion_4_quarter || 0);

  const purchases = Number(stats.conversion_purchases || 0);
  const purchaseValue =
    Number(stats.conversion_purchases_value || 0) / 1_000_000;

  const frequency = Number(stats.frequency || 0) || safeDivide(impressions, reach);
  const ctr = Number(stats.swipe_up_rate || 0) * 100 || safeDivide(swipes, impressions) * 100;
  const cpc = safeDivide(spend, swipes);
  const cpm = safeDivide(spend, impressions) * 1000;
  const roas = safeDivide(purchaseValue, spend);
  const cpa = safeDivide(spend, purchases);

  const hookRate = safeDivide(videoViews, impressions) * 100;
  const holdRate = safeDivide(v50, v25 || videoViews) * 100;
  const completionRate = safeDivide(v100, videoViews) * 100;

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
    video_25: v25,
    video_50: v50,
    video_75: v75,
    video_100: v100,
    hook_rate: Number(hookRate.toFixed(2)),
    hold_rate: Number(holdRate.toFixed(2)),
    completion_rate: Number(completionRate.toFixed(2)),

    _raw: stats
  };
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
    let statsMap = {};
    let statsEntityType = "campaigns";

    if (level === "campaign") {
      const data = await snap(`/adaccounts/${accountId}/campaigns`, token);
      entities = (data.campaigns || []).map((item) => item.campaign);
      statsEntityType = "campaigns";
    } else if (level === "adsquad") {
      const data = await snap(`/adaccounts/${accountId}/adsquads`, token);
      entities = (data.adsquads || []).map((item) => item.adsquad);
      statsEntityType = "adsquads";
    } else if (level === "ad") {
      const data = await snap(`/adaccounts/${accountId}/ads`, token);
      entities = (data.ads || []).map((item) => item.ad);
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

    statsMap = await fetchStats(statsEntityType, ids, dateParams, token);

    const enriched = entities.map((entity) =>
      enrichEntity(entity, statsMap[entity.id] || {}, level)
    );

    const summary = enriched.reduce(
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

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      account_id: accountId,
      level,
      date_preset: since && until ? "custom" : datePreset,
      date_range: dateParams,
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
