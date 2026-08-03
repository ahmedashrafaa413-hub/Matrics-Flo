import { createSupabaseAdminClient } from "./supabaseServer";
import { getSnapchatTokenForWorkspace } from "./snapchatToken";
import {
  getDateRange,
  fetchEntities,
  fetchAccountStats,
  fetchBreakdownStats,
  mergeBreakdownEntities
} from "./snapchatApi";


async function fetchLevelWithStats({
  accountId,
  level,
  token,
  startTime,
  endTime,
  swipeWindow,
  viewWindow,
  parentCampaignIds = []
}) {
  // Snapchat documents async reporting as the correct path for large reports.
  // Ad Squad breakdowns are only valid on Campaign stats endpoints, so list
  // metadata first and pass the complete parent campaign set to the reporter.
  const entitiesResult = await fetchEntities({ accountId, level, token });

  if (!entitiesResult.ok) {
    throw new Error(
      `Failed to list Snapchat ${level} entities: ${JSON.stringify(entitiesResult.error)}`
    );
  }

  const campaignIds = level === "adsquad"
    ? [...new Set(
        (parentCampaignIds.length
          ? parentCampaignIds
          : entitiesResult.entities.map((entity) => entity.campaign_id)
        ).filter(Boolean)
      )]
    : [];
  const breakdownResult = await fetchBreakdownStats({
    accountId,
    level,
    token,
    startTime,
    endTime,
    swipeWindow,
    viewWindow,
    campaignIds
  });

  if (!breakdownResult.ok) {
    throw new Error(
      `Failed to load complete Snapchat ${level} report: ${JSON.stringify(breakdownResult.error)}`
    );
  }

  return mergeBreakdownEntities(breakdownResult.rows, entitiesResult.entities);
}

export async function syncSnapchatWorkspace({
  workspaceId,
  accountId,
  datePreset,
  metricDate,
  levels,
  limit,
  candidateLimit,
  swipeWindow,
  viewWindow
}) {
  const token = await getSnapchatTokenForWorkspace(workspaceId);
  if (!token) {
    const error = new Error("Not connected to Snapchat");
    error.status = 401;
    throw error;
  }

  const { startTime, endTime } = getDateRange(datePreset);
  const admin = createSupabaseAdminClient();

  const { data: accountConnection, error: accountConnectionError } = await admin
    .from("platform_connections")
    .select("account_currency")
    .eq("workspace_id", workspaceId)
    .eq("provider", "snapchat")
    .eq("account_id", accountId)
    .maybeSingle();

  if (accountConnectionError) throw new Error(accountConnectionError.message);

  const accountCurrency = accountConnection?.account_currency || "USD";
  let insertedRows = 0;
  const errors = [];
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
        const campaignRows = await getCampaignStats();
        const accountStats = await fetchAccountStats({
          accountId,
          token,
          startTime,
          endTime,
          swipeWindow,
          viewWindow,
          campaignRows
        });

        if (!accountStats.ok) {
          throw new Error(
            `Failed to load Snapchat account total: ${JSON.stringify(accountStats.error)}`
          );
        }

        rows = [
          {
            entity_id: accountId,
            entity_name: "Account Total",
            ...accountStats.metrics
          }
        ];
      } else {
        let levelStats;
        if (level === "campaign") {
          levelStats = await getCampaignStats();
        } else {
          // Only campaigns present in the complete campaign report have
          // delivery/conversion data for this range. Restricting Ad Squad
          // reports to those parents preserves every result while avoiding
          // hundreds of empty reports and Vercel/Snapchat timeouts.
          const parentCampaignIds = level === "adsquad"
            ? (await getCampaignStats()).map((row) => row.entity_id)
            : [];
          levelStats = await fetchLevelWithStats({
                accountId,
                level,
                token,
                startTime,
                endTime,
                swipeWindow,
                viewWindow,
                candidateLimit,
                parentCampaignIds
              });
        }

        const failedStats = levelStats.filter((row) => !row.ok);
        if (failedStats.length) {
          throw new Error(
            `${failedStats.length} Snapchat ${level} stat request(s) failed; the previous complete cache was kept.`
          );
        }

        rows = levelStats
          .map((row) => ({
            entity_id: row.entity_id,
            entity_name: row.entity_name,
            status: row.status,
            ...row.metrics
          }))
          // Keep every row that has delivery or attributed conversion data.
          // Purchases can be attributed to paused/deleted entities with no
          // spend in the selected range, so spend alone is not a safe filter.
          .filter(
            (row) =>
              row.spend > 0.001 ||
              row.revenue > 0 ||
              row.purchases > 0 ||
              row.impressions > 0 ||
              row.clicks > 0
          )
          .sort((a, b) => b.spend - a.spend);
      }

      const { error: deleteError } = await admin
        .from("platform_daily_metrics")
        .delete()
        .eq("workspace_id", workspaceId)
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

      const now = new Date().toISOString();
      const payloadRows = rows.map((row) => ({
        workspace_id: workspaceId,
        provider: "snapchat",
        account_id: accountId,
        entity_level: level,
        entity_id: String(row.entity_id),
        entity_name: row.entity_name || String(row.entity_id),
        metric_date: metricDate,
        currency: accountCurrency,
        spend: row.spend || 0,
        revenue: row.revenue || 0,
        purchases: row.purchases || 0,
        impressions: row.impressions || 0,
        clicks: row.clicks || row.swipes || 0,
        video_views: row.video_views || 0,
        raw: {
          ...row,
          date_preset: datePreset,
          swipe_window: swipeWindow,
          view_window: viewWindow
        },
        created_at: now,
        updated_at: now
      }));

      const { error: insertError } = await admin
        .from("platform_daily_metrics")
        .insert(payloadRows);

      if (insertError) {
        errors.push({ level, step: "insert", error: insertError.message });
        continue;
      }

      insertedRows += payloadRows.length;
    } catch (error) {
      errors.push({ level, step: "fetch", error: error.message });
    }
  }

  if (errors.length) {
    const error = new Error(errors[0]?.error || "Snapchat sync was incomplete.");
    error.details = errors;
    throw error;
  }

  return {
    success: true,
    provider: "Snapchat Ads",
    version: "snapchat-complete-async-reporting-v2",
    workspace_id: workspaceId,
    account_id: accountId,
    date_preset: datePreset,
    metric_date: metricDate,
    levels_synced: levels,
    report_mode: "async",
    inserted_rows: insertedRows
  };
}
