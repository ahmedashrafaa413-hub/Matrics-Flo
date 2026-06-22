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

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "last_30d";
    const requestedLevel = searchParams.get("level") || "campaign";
    const entityLevel = normalizeLevel(requestedLevel);
    const metricDate = searchParams.get("metric_date") || todayDate();

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

    const { data, error } = await admin
      .from("platform_daily_metrics")
      .select("*")
      .eq("workspace_id", workspace.id)
      .eq("provider", "snapchat")
      .eq("account_id", accountId)
      .eq("metric_date", metricDate)
      .eq("entity_level", entityLevel)
      .filter("raw->>date_preset", "eq", datePreset)
      .order("spend", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const dbRows = data || [];

    const rows = dbRows.map((item) => ({
      id: item.entity_id,
      name: item.entity_name,
      currency: item.currency || "USD",
      spend: safeNum(item.spend),
      revenue: safeNum(item.revenue),
      purchase_value: safeNum(item.revenue),
      purchases: safeNum(item.purchases),
      impressions: safeNum(item.impressions),
      swipes: safeNum(item.clicks),
      clicks: safeNum(item.clicks),
      video_views: safeNum(item.video_views),
      roas: fix2(safeNum(item.spend) ? safeNum(item.revenue) / safeNum(item.spend) : 0),
      cpa: fix2(safeNum(item.purchases) ? safeNum(item.spend) / safeNum(item.purchases) : 0),
      ctr: fix2(
        safeNum(item.impressions)
          ? (safeNum(item.clicks) / safeNum(item.impressions)) * 100
          : 0
      ),
      cpc: fix2(safeNum(item.clicks) ? safeNum(item.spend) / safeNum(item.clicks) : 0),
      cpm: fix2(
        safeNum(item.impressions)
          ? (safeNum(item.spend) / safeNum(item.impressions)) * 1000
          : 0
      ),
      raw: item.raw || {}
    }));

    const summary =
      entityLevel === "account" && rows[0]
        ? {
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
          }
        : buildSummary(rows);

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-data-from-supabase-v1",
      source: "supabase_cache",
      workspace_id: workspace.id,
      account_id: accountId,
      level: requestedLevel,
      entity_level: entityLevel,
      date_preset: datePreset,
      metric_date: metricDate,
      loaded_rows: rows.length,
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
        version: "snapchat-data-from-supabase-v1",
        error: error.message || "Failed to load Snapchat cached data"
      },
      { status: error.status || 500 }
    );
  }
}
