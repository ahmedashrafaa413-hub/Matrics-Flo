import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { getSnapchatToken } from "../../../../lib/snapchatToken";
import {
  getDateRange,
  fetchAccountSummary,
  fetchEntities,
  fetchBreakdown,
  buildMetrics,
  VALID_SWIPE,
  VALID_VIEW
} from "../../../../lib/snapchatApi";

export const dynamic = "force-dynamic";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeLevel(level) {
  const raw = String(level || "campaign").toLowerCase().trim();

  if (raw === "overview" || raw === "account") return "account";
  if (raw === "campaign" || raw === "campaigns") return "campaign";
  if (raw === "adsquad" || raw === "ad_squad" || raw === "ad_squads") {
    return "adsquad";
  }
  if (raw === "ad" || raw === "ads") return "ad";

  return null;
}

// Builds the rows to persist for one entity level (account / campaign /
// adsquad / ad) — one row per entity, plus for "account" a single
// account-total row.
async function buildRowsForLevel({
  accountId,
  level,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow,
  limit
}) {
  if (level === "account") {
    const summary = await fetchAccountSummary({
      accountId,
      token,
      startTime,
      endTime,
      swipeWindow,
      viewWindow
    });

    if (!summary) {
      throw new Error(
        "Snapchat account stats request failed (see Snapchat Ads Manager permissions/date range)"
      );
    }

    return [
      {
        entity_id: accountId,
        entity_name: "Account Total",
        ...summary
      }
    ];
  }

  const [entitiesResult, breakdownResult] = await Promise.all([
    fetchEntities({ accountId, level, token }),
    fetchBreakdown({ accountId, level, token, startTime, endTime, swipeWindow, viewWindow })
  ]);

  if (!entitiesResult.ok) {
    throw new Error(
      `Failed to list Snapchat ${level} entities: ${JSON.stringify(entitiesResult.error)}`
    );
  }

  if (!breakdownResult.ok) {
    throw new Error(
      `Failed to fetch Snapchat ${level} stats breakdown: ${JSON.stringify(breakdownResult.error)}`
    );
  }

  const rows = entitiesResult.entities
    .map((entity) => ({
      entity_id: entity.id,
      entity_name: entity.name,
      status: entity.status,
      ...(breakdownResult.statsById[entity.id]
        ? buildMetrics(breakdownResult.statsById[entity.id])
        : {
            spend: 0,
            revenue: 0,
            purchases: 0,
            impressions: 0,
            swipes: 0,
            clicks: 0
          })
    }))
    .filter((row) => row.spend > 0.001)
    .sort((a, b) => b.spend - a.spend);

  return limit ? rows.slice(0, limit) : rows;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "last_30d";
    const metricDate = searchParams.get("metric_date") || todayDate();
    const levelsParam = searchParams.get("levels") || searchParams.get("level") || "campaign";
    const limit = Number(searchParams.get("limit") || 20);

    const swRaw = searchParams.get("swipe_window") || "28_DAY";
    const vwRaw = searchParams.get("view_window") || "1_DAY";
    const swipeWindow = VALID_SWIPE.includes(swRaw) ? swRaw : "28_DAY";
    const viewWindow = VALID_VIEW.includes(vwRaw) ? vwRaw : "1_DAY";

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: "account_id is required" },
        { status: 400 }
      );
    }

    const levels = Array.from(
      new Set(
        levelsParam
          .split(",")
          .map((item) => normalizeLevel(item))
          .filter(Boolean)
      )
    );

    if (!levels.length) {
      return NextResponse.json(
        { success: false, error: "No valid levels requested" },
        { status: 400 }
      );
    }

    const { workspace } = await getActiveWorkspace(request);

    const token = await getSnapchatToken(request);

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Not connected to Snapchat" },
        { status: 401 }
      );
    }

    const { startTime, endTime } = getDateRange(datePreset);
    const admin = createSupabaseAdminClient();

    let insertedRows = 0;
    const errors = [];

    for (const level of levels) {
      try {
        const rows = await buildRowsForLevel({
          accountId,
          level,
          token,
          startTime,
          endTime,
          swipeWindow,
          viewWindow,
          limit
        });

        // Replace whatever was cached for this exact scope so re-syncing
        // never accumulates stale/duplicate rows (platform_daily_metrics
        // has no unique constraint to upsert against).
        const { error: deleteError } = await admin
          .from("platform_daily_metrics")
          .delete()
          .eq("workspace_id", workspace.id)
          .eq("provider", "snapchat")
          .eq("account_id", accountId)
          .eq("metric_date", metricDate)
          .eq("entity_level", level)
          .filter("raw->>date_preset", "eq", datePreset);

        if (deleteError) {
          errors.push({ level, step: "delete", error: deleteError.message });
          continue;
        }

        if (!rows.length) continue;

        const payloadRows = rows.map((row) => ({
          workspace_id: workspace.id,
          provider: "snapchat",
          account_id: accountId,
          entity_level: level,
          entity_id: String(row.entity_id),
          entity_name: row.entity_name || String(row.entity_id),
          metric_date: metricDate,
          currency: "USD",
          spend: row.spend || 0,
          revenue: row.revenue || 0,
          purchases: row.purchases || 0,
          impressions: row.impressions || 0,
          clicks: row.clicks || row.swipes || 0,
          video_views: 0,
          raw: {
            ...row,
            date_preset: datePreset,
            swipe_window: swipeWindow,
            view_window: viewWindow
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }));

        const { error: insertError } = await admin
          .from("platform_daily_metrics")
          .insert(payloadRows);

        if (insertError) {
          errors.push({ level, step: "insert", error: insertError.message });
          continue;
        }

        insertedRows += payloadRows.length;
      } catch (levelError) {
        errors.push({ level, step: "fetch", error: levelError.message });
      }
    }

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-sync-v2-live",
      workspace_id: workspace.id,
      account_id: accountId,
      date_preset: datePreset,
      metric_date: metricDate,
      levels_synced: levels,
      inserted_rows: insertedRows,
      errors
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "Snapchat Ads",
        error: error.message || "Snapchat sync failed"
      },
      { status: error.status || 500 }
    );
  }
}
