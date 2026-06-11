import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

const BASIC_FIELDS = [
  "impressions",
  "spend",
  "swipes",
  "conversion_purchases",
  "conversion_purchases_value",
  "video_views"
];

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

function getDateRange(datePreset) {
  const now = new Date();

  const end = new Date(now);
  end.setDate(end.getDate() + 1);

  const start = new Date(now);

  if (datePreset === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (datePreset === "yesterday") {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);

    end.setDate(now.getDate());
    end.setHours(0, 0, 0, 0);
  } else if (datePreset === "last_7d") {
    start.setDate(start.getDate() - 7);
  } else if (datePreset === "last_30d") {
    start.setDate(start.getDate() - 30);
  } else if (datePreset === "this_month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (datePreset === "last_90d") {
    start.setDate(start.getDate() - 90);
  } else if (datePreset === "maximum") {
    start.setFullYear(start.getFullYear() - 3);
  } else {
    start.setDate(start.getDate() - 30);
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString()
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

function extractCampaigns(payload) {
  const rows = payload?.campaigns || [];

  return rows
    .map((item) => item.campaign || item)
    .filter(Boolean)
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name || "Unnamed Campaign",
      status: campaign.status || campaign.effective_status || "",
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
      campaign_id: adsquad.campaign_id || "",
      status: adsquad.status || adsquad.effective_status || "",
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
      status: ad.status || ad.effective_status || "",
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

function normalizeRow(entity, stats) {
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

async function getEntityStats({ entityType, entityId, token, startTime, endTime }) {
  const fields = BASIC_FIELDS.join(",");

  const url =
    `${BASE}/${entityType}/${entityId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(fields)}` +
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
    stats: extractStats(result.data, entityId),
    url
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const accountId = searchParams.get("account_id");
  const level = searchParams.get("level") || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_30d";

  if (!accountId) {
    return NextResponse.json({
      success: false,
      error: "account_id is required"
    });
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
  const entityType = getStatsEntityType(level);

  const limitedEntities = entities.slice(0, 50);

  const rows = [];

  for (const entity of limitedEntities) {
    const statsResult = await getEntityStats({
      entityType,
      entityId: entity.id,
      token,
      startTime,
      endTime
    });

    if (statsResult.ok) {
      rows.push(normalizeRow(entity, statsResult.stats));
    } else {
      rows.push(
        normalizeRow(entity, {
          impressions: 0,
          spend: 0,
          swipes: 0,
          conversion_purchases: 0,
          conversion_purchases_value: 0,
          video_views: 0
        })
      );
    }
  }

  const summary = buildSummary(rows);

  return NextResponse.json({
    success: true,
    version: "snapchat-insights-basic-conversions-video-v1",
    account_id: accountId,
    level,
    date_preset: datePreset,
    entity_type: entityType,
    fields: BASIC_FIELDS,
    count: rows.length,
    limited_to: limitedEntities.length,
    summary,
    data: rows
  });
}
