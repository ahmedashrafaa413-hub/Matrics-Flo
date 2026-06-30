import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { getActiveWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

function safeNum(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function fix2(value) {
  return Number(safeNum(value).toFixed(2));
}

function normalizeLevel(level) {
  const raw = String(level || "campaign").toLowerCase();

  if (raw === "overview" || raw === "account") return "account";
  if (raw === "campaign" || raw === "campaigns") return "campaign";
  if (raw === "adsquad" || raw === "ad_squad" || raw === "ad_squads") {
    return "adsquad";
  }
  if (raw === "ad" || raw === "ads") return "ad";

  return "campaign";
}

function buildSummary(rows) {
  const total = rows.reduce(
    (acc, row) => {
      acc.spend += safeNum(row.spend);
      acc.revenue += safeNum(row.revenue);
      acc.purchases += safeNum(row.purchases);
      acc.impressions += safeNum(row.impressions);
      acc.clicks += safeNum(row.clicks);
      acc.video_views += safeNum(row.video_views);
      return acc;
    },
    {
      spend: 0,
      revenue: 0,
      purchases: 0,
      impressions: 0,
      clicks: 0,
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
    swipes: total.clicks,
    clicks: total.clicks,
    video_views: total.video_views,
    roas: fix2(total.spend ? total.revenue / total.spend : 0),
    cpa: fix2(total.purchases ? total.spend / total.purchases : 0),
    ctr: fix2(total.impressions ? (total.clicks / total.impressions) * 100 : 0),
    cpc: fix2(total.clicks ? total.spend / total.clicks : 0),
    cpm: fix2(total.impressions ? (total.spend / total.impressions) * 1000 : 0),
    video_view_rate: fix2(
      total.impressions ? (total.video_views / total.impressions) * 100 : 0
    )
  };
}

function normalizeRow(item) {
  const spend = safeNum(item.spend);
  const revenue = safeNum(item.revenue);
  const purchases = safeNum(item.purchases);
  const impressions = safeNum(item.impressions);
  const clicks = safeNum(item.clicks);
  const videoViews = safeNum(item.video_views);

  return {
    id: item.entity_id,
    name: item.entity_name,
    currency: item.currency || "USD",
    spend,
    revenue,
    purchase_value: revenue,
    purchases,
    impressions,
    swipes: clicks,
    clicks,
    video_views: videoViews,
    roas: fix2(spend ? revenue / spend : 0),
    cpa: fix2(purchases ? spend / purchases : 0),
    ctr: fix2(impressions ? (clicks / impressions) * 100 : 0),
    cpc: fix2(clicks ? spend / clicks : 0),
    cpm: fix2(impressions ? (spend / impressions) * 1000 : 0),
    status: item.raw?.status || item.raw?.raw_status || "UNKNOWN",
    raw: item.raw || {}
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "last_30d";
    const requestedLevel = searchParams.get("level") || "campaign";
    const entityLevel = normalizeLevel(requestedLevel);
    const metricDate = searchParams.get("metric_date") || todayDate();

    const page = Math.max(Number(searchParams.get("page") || 1), 1);
    const pageSize = Math.min(
      Math.max(Number(searchParams.get("page_size") || 50), 10),
      200
    );

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (!accountId) {
      return NextResponse.json(
        {
          success: false,
          error: "account_id is required"
        },
        { status: 400 }
      );
    }

    const { workspace } = await getActiveWorkspace(request);
    const admin = createSupabaseAdminClient();

    const baseQuery = admin
      .from("platform_daily_metrics")
      .select("*", { count: "exact" })
      .eq("workspace_id", workspace.id)
      .eq("provider", "snapchat")
      .eq("account_id", accountId)
      .eq("metric_date", metricDate)
      .eq("entity_level", entityLevel)
      .filter("raw->>date_preset", "eq", datePreset)
      .order("spend", { ascending: false });

    const { data, error, count } =
      entityLevel === "account"
        ? await baseQuery.limit(1)
        : await baseQuery.range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    const dbRows = data || [];
    const rows = dbRows.map(normalizeRow);

    let summary = null;

    if (entityLevel === "account" && rows[0]) {
      summary = {
        currency: rows[0].currency,
        spend: rows[0].spend,
        revenue: rows[0].revenue,
        purchase_value: rows[0].purchase_value,
        purchases: rows[0].purchases,
        impressions: rows[0].impressions,
        swipes: rows[0].swipes,
        clicks: rows[0].clicks,
        video_views: rows[0].video_views,
        roas: rows[0].roas,
        cpa: rows[0].cpa,
        ctr: rows[0].ctr,
        cpc: rows[0].cpc,
        cpm: rows[0].cpm
      };
    } else {
      const { data: allSummaryRows, error: summaryError } = await admin
        .from("platform_daily_metrics")
        .select("spend,revenue,purchases,impressions,clicks,video_views,currency")
        .eq("workspace_id", workspace.id)
        .eq("provider", "snapchat")
        .eq("account_id", accountId)
        .eq("metric_date", metricDate)
        .eq("entity_level", entityLevel)
        .filter("raw->>date_preset", "eq", datePreset);

      if (summaryError) {
        throw new Error(summaryError.message);
      }

      summary = buildSummary(allSummaryRows || []);
    }

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-data-from-supabase-v2-paginated",
      source: "supabase_cache",
      workspace_id: workspace.id,
      account_id: accountId,
      level: requestedLevel,
      entity_level: entityLevel,
      date_preset: datePreset,
      metric_date: metricDate,
      page,
      page_size: pageSize,
      total_rows: count || rows.length,
      loaded_rows: rows.length,
      has_more: entityLevel !== "account" ? to + 1 < (count || 0) : false,
      summary,
      rows,
      data: rows,
      is_cached_data: true
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "Snapchat Ads",
        version: "snapchat-data-from-supabase-v2-paginated",
        error: error.message || "Failed to load Snapchat cached data"
      },
      { status: error.status || 500 }
    );
  }
}
