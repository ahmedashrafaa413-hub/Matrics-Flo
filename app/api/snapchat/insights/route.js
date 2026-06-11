import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

async function snap(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Snapchat API error: ${res.status}`);
  return res.json();
}

// Build date params — Snapchat uses ISO 8601
function buildDateParams(datePreset, since, until) {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];

  if (since && until) {
    return { start_time: `${since}T00:00:00.000Z`, end_time: `${until}T23:59:59.000Z` };
  }

  const presets = {
    today:      { start: today,                              end: today },
    yesterday:  { start: daysAgo(1),                        end: daysAgo(1) },
    last_7d:    { start: daysAgo(7),                        end: today },
    last_30d:   { start: daysAgo(30),                       end: today },
    this_month: { start: `${today.slice(0,7)}-01`,          end: today },
    last_90d:   { start: daysAgo(90),                       end: today },
    maximum:    { start: daysAgo(365),                      end: today },
  };

  const range = presets[datePreset] || presets["last_30d"];
  return {
    start_time: `${range.start}T00:00:00.000Z`,
    end_time:   `${range.end}T23:59:59.000Z`,
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function safeDivide(a, b) {
  const x = Number(a || 0), y = Number(b || 0);
  return y ? x / y : 0;
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
  "conversion_purchases_value",
].join(",");

// Fetch stats — manual URL to avoid comma encoding
async function fetchStats(entityPath, ids, dateParams, token) {
  const statsMap = {};

  // Batch into chunks of 10 to avoid rate limits
  const chunkSize = 10;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    await Promise.allSettled(
      chunk.map(async (id) => {
        try {
          const url = `${BASE}${entityPath}/${id}/stats`
            + `?granularity=LIFETIME`
            + `&fields=${STATS_FIELDS}`
            + `&start_time=${encodeURIComponent(dateParams.start_time)}`
            + `&end_time=${encodeURIComponent(dateParams.end_time)}`;

          const res  = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const data = await res.json();
          // Debug: store first response to inspect
          if (!statsMap["__debug__"] && data) {
            statsMap["__debug__"] = data;
          }
          statsMap[id] = data.total_stats?.[0]?.total_stat?.stats || {};
        } catch {
          statsMap[id] = {};
        }
      })
    );
  }
  return statsMap;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token      = searchParams.get("token") || cookies().get("snapchat_token")?.value;
  const accountId  = searchParams.get("account_id");
  const level      = searchParams.get("level")       || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_30d";
  const since      = searchParams.get("since");
  const until      = searchParams.get("until");

  if (!token) return NextResponse.json({ success: false, error: "Not connected to Snapchat" }, { status: 401 });
  if (!accountId) return NextResponse.json({ success: false, error: "account_id is required" }, { status: 400 });

  const dateParams = buildDateParams(datePreset, since, until);

  try {
    let entities = [];
    let statsMap = {};

    if (level === "campaign") {
      const data = await snap(`/adaccounts/${accountId}/campaigns`, token);
      entities   = (data.campaigns || []).map(c => c.campaign);
      const ids  = entities.map(e => e.id);
      statsMap   = await fetchStats(`/adaccounts/${accountId}/campaigns`, ids, dateParams, token);

    } else if (level === "adsquad") {
      const data = await snap(`/adaccounts/${accountId}/adsquads`, token);
      entities   = (data.adsquads || []).map(a => a.adsquad);
      const ids  = entities.map(e => e.id);
      statsMap   = await fetchStats(`/adaccounts/${accountId}/adsquads`, ids, dateParams, token);

    } else if (level === "ad") {
      const data = await snap(`/adaccounts/${accountId}/ads`, token);
      entities   = (data.ads || []).map(a => a.ad);
      const ids  = entities.map(e => e.id);
      statsMap   = await fetchStats(`/adaccounts/${accountId}/ads`, ids, dateParams, token);
    }

    // Enrich each entity with stats + computed metrics
    const enriched = entities.map(entity => {
      const s = statsMap[entity.id] || {};

      const spend       = Number(s.spend        || 0) / 1_000_000; // micro to dollars
      const impressions = Number(s.impressions   || 0);
      const swipes      = Number(s.swipes        || 0); // link clicks
      const videoViews  = Number(s.video_views   || 0);
      const reach       = Number(s.reach         || 0);
      const frequency   = safeDivide(impressions, reach);
      const ctr         = Number(s.swipe_up_rate || 0) * 100; // already ratio → percent
      const cpm         = impressions > 0 ? (spend / impressions) * 1000 : 0;
      const cpc         = swipes > 0 ? spend / swipes : 0;

      // Conversions
      const purchases     = Number(s.conversion_purchases       || 0);
      const purchaseValue = Number(s.conversion_purchases_value || 0) / 1_000_000;
      const roas          = safeDivide(purchaseValue, spend);
      const cpa           = safeDivide(spend, purchases);

      // Video funnel — Snapchat % quartiles
      const v25  = Number(s.view_completion_1_quarter || 0);
      const v50  = Number(s.view_completion_2_quarter || 0);
      const v75  = Number(s.view_completion_3_quarter || 0);
      const v100 = Number(s.view_completion_4_quarter || 0);

      // Hook Rate: 2s views / impressions — approximated via video_views
      const hookRate       = impressions > 0 ? safeDivide(videoViews, impressions) * 100 : 0;
      const completionRate = videoViews > 0  ? v100 * 100 : 0; // already decimal
      const holdRate       = videoViews > 0  ? (v50 / (v25 || 1)) * 100 : 0; // p50/p25

      return {
        // Identity
        id:            entity.id,
        name:          entity.name,
        status:        entity.status,
        campaign_id:   entity.campaign_id   || entity.id,
        campaign_name: entity.campaign_name || entity.name,
        adsquad_id:    entity.adsquad_id,
        adsquad_name:  entity.ad_squad_name,
        ad_id:         level === "ad" ? entity.id : null,
        ad_name:       level === "ad" ? entity.name : null,

        // Core metrics
        spend:         +spend.toFixed(2),
        impressions,
        swipes,
        clicks:        swipes,
        reach,
        frequency:     +frequency.toFixed(2),
        ctr:           +ctr.toFixed(2),
        cpm:           +cpm.toFixed(2),
        cpc:           +cpc.toFixed(2),

        // Conversions
        purchases,
        purchase_value:  +purchaseValue.toFixed(2),
        roas:            +roas.toFixed(2),
        cpa:             +cpa.toFixed(2),

        // Video
        video_views:     videoViews,
        video_25:        v25,
        video_50:        v50,
        video_75:        v75,
        video_100:       v100,
        hook_rate:       +hookRate.toFixed(2),
        hold_rate:       +holdRate.toFixed(2),
        completion_rate: +completionRate.toFixed(2),

        // Raw
        _raw: s,
      };
    });

    // Summary totals
    const summary = enriched.reduce((acc, r) => {
      acc.spend          += r.spend;
      acc.impressions    += r.impressions;
      acc.clicks         += r.clicks;
      acc.purchases      += r.purchases;
      acc.purchase_value += r.purchase_value;
      return acc;
    }, { spend:0, impressions:0, clicks:0, purchases:0, purchase_value:0 });

    summary.roas = +safeDivide(summary.purchase_value, summary.spend).toFixed(2);
    summary.cpa  = +safeDivide(summary.spend, summary.purchases).toFixed(2);
    summary.ctr  = +safeDivide(summary.clicks, summary.impressions * 100).toFixed(2);

    return NextResponse.json({
      success:    true,
      provider:   "Snapchat Ads",
      account_id: accountId,
      level,
      date_preset: since && until ? "custom" : datePreset,
      data:        enriched,
      summary,
      _debug:      statsMap["__debug__"] || null,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
