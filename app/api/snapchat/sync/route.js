import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { getActiveWorkspace } from "../../../../lib/workspace";
import { getSnapchatToken } from "../../../../lib/snapchatToken";
import {
  getDateRange,
  fetchEntities,
  fetchEntityStats,
  mapWithConcurrency,
  buildMetrics,
  VALID_SWIPE,
  VALID_VIEW
} from "../../../../lib/snapchatApi";

export const dynamic = "force-dynamic";

const CONCURRENCY = 6;

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

// Fetches every entity of `level` (up to candidateLimit) plus its stats,
// one Snapchat request per entity (see lib/snapchatApi.js fetchEntityStats
// for why: the bulk "?breakdown=" endpoint silently returns empty/zero
// stats for accounts with a large number of campaigns).
async function fetchLevelWithStats({
  accountId,
  level,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow,
  candidateLimit
}) {
  const entitiesResult = await fetchEntities({ accountId, level, token });

  if (!entitiesResult.ok) {
    throw new Error(
      `Failed to list Snapchat ${level} entities: ${JSON.stringify(entitiesResult.error)}`
    );
  }

  const scanned = entitiesResult.entities.slice(0, candidateLimit);

  const statsResults = await mapWithConcurrency(
    scanned,
    CONCURRENCY,
    async (entity) => {
      const result = await fetchEntityStats({
        level, entityId: entity.id, token, startTime, endTime, swipeWindow, viewWindow
      });

      return {
        entity_id: entity.id,
        entity_name: entity.name,
        status: entity.status,
        ok: result.ok,
        stats: result.ok ? result.stats : {},
        metrics: result.ok ? result.metrics : buildMetrics({})
      };
    }
  );

  return statsResults;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "last_30d";
    const metricDate = searchParams.get("metric_date") || todayDate();
    const levelsParam = searchParams.get("levels") || searchParams.get("level") || "campaign";
    const limit = Number(searchParams.get("limit") || 20);
    const candidateLimit = Math.min(
      Math.max(Number(searchParams.get("candidate_limit") || 500), 1),
      1000
    );

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

    // "account" always sums the full campaign list — it's the single
    // source of truth for the top-line summary cards, so it must reflect
    // every campaign, not just the top N that get saved as "campaign" rows.
    // Fetch it once and reuse for the "campaign" level below if both were
    // requested, instead of hitting Snapchat twice for the same data.
    let campaignStatsCache = null;

    async function getCampaignStats() {
      if (!campaignStatsCache) {
        campaignStatsCache = await fetchLevelWithStats({
          accountId,
          level: "campaign",
          token,
          startTime,
          endTime,
          swipeWindow,
          viewWindow,
          candidateLimit
        });
      }
      return campaignStatsCache;
    }

    for (const level of levels) {
      try {
        let rows;

        if (level === "account") {
          const campaignStats = await getCampaignStats();

          const summedStats = campaignStats.reduce((acc, row) => {
            for (const key of Object.keys(row.stats || {})) {
              acc[key] = (Number(acc[key]) || 0) + (Number(row.stats[key]) || 0);
            }
            return acc;
          }, {});

          rows = [
            {
              entity_id: accountId,
              entity_name: "Account Total",
              ...buildMetrics(summedStats)
            }
          ];
        } else {
          const levelStats =
            level === "campaign" ? await getCampaignStats() : await fetchLevelWithStats({
              accountId,
              level,
              token,
              startTime,
              endTime,
              swipeWindow,
              viewWindow,
              candidateLimit
            });

          rows = levelStats
            .map((row) => ({
              entity_id: row.entity_id,
              entity_name: row.entity_name,
              status: row.status,
              ...row.metrics
            }))
            .filter((row) => row.spend > 0.001)
            .sort((a, b) => b.spend - a.spend)
            .slice(0, limit);
        }

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
      version: "snapchat-sync-v3-per-entity",
      workspace_id: workspace.id,
      account_id: accountId,
      date_preset: datePreset,
      metric_date: metricDate,
      levels_synced: levels,
      candidate_limit: candidateLimit,
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
