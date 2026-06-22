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

function getAppOrigin(request) {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    new URL(request.url).origin
  );
}

function normalizeMetricRow({
  workspaceId,
  accountId,
  metricDate,
  level,
  row,
  datePreset,
  sourceMeta
}) {
  return {
    workspace_id: workspaceId,
    connection_id: null,
    provider: "snapchat",
    account_id: accountId,

    entity_level: level,
    entity_id: row.id || accountId,
    entity_name: row.name || row.campaign_name || row.adsquad_name || row.ad_name || "Snapchat",

    metric_date: metricDate,
    currency: row.currency || "USD",

    spend: safeNum(row.spend),
    revenue: safeNum(row.revenue || row.purchase_value),
    purchases: safeNum(row.purchases),
    impressions: safeNum(row.impressions),
    clicks: safeNum(row.clicks || row.swipes),
    video_views: safeNum(row.video_views),

    raw: {
      ...row,
      date_preset: datePreset,
      snapchat_level: level,
      synced_from: "snapchat_insights_api",
      source_meta: sourceMeta
    },

    updated_at: new Date().toISOString()
  };
}

async function fetchInsights({
  request,
  accountId,
  level,
  datePreset,
  limit,
  candidateLimit
}) {
  const origin = getAppOrigin(request);

  const url =
    `${origin}/api/snapchat/insights` +
    `?account_id=${encodeURIComponent(accountId)}` +
    `&level=${encodeURIComponent(level)}` +
    `&date_preset=${encodeURIComponent(datePreset)}` +
    `&limit=${encodeURIComponent(String(limit))}` +
    `&candidate_limit=${encodeURIComponent(String(candidateLimit))}` +
    `&force=1`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      cookie: request.headers.get("cookie") || ""
    }
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.success) {
    throw new Error(
      data?.error || `Failed to fetch Snapchat ${level} insights`
    );
  }

  return data;
}

async function deleteOldCache({
  admin,
  workspaceId,
  accountId,
  metricDate,
  datePreset
}) {
  await admin
    .from("platform_daily_metrics")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("provider", "snapchat")
    .eq("account_id", accountId)
    .eq("metric_date", metricDate)
    .filter("raw->>date_preset", "eq", datePreset);
}

async function insertMetrics({ admin, rows }) {
  if (!rows.length) {
    return {
      inserted: 0
    };
  }

  const { error } = await admin.from("platform_daily_metrics").insert(rows);

  if (error) {
    throw new Error(error.message);
  }

  return {
    inserted: rows.length
  };
}

export async function GET(request) {
  return syncSnapchat(request);
}

export async function POST(request) {
  return syncSnapchat(request);
}

async function syncSnapchat(request) {
  const startedAt = new Date().toISOString();

  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "last_30d";

    const levelsParam = searchParams.get("levels") || "overview,campaign";
    const levels = levelsParam
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") || 20), 1),
      100
    );

    const candidateLimit = Math.min(
      Math.max(Number(searchParams.get("candidate_limit") || 160), limit),
      300
    );

    if (!accountId) {
      return NextResponse.json(
        {
          success: false,
          error: "account_id is required"
        },
        { status: 400 }
      );
    }

    const { user, workspace } = await getActiveWorkspace(request);
    const admin = createSupabaseAdminClient();

    const workspaceId = workspace.id;
    const metricDate = todayDate();

    await deleteOldCache({
      admin,
      workspaceId,
      accountId,
      metricDate,
      datePreset
    });

    const insertedRows = [];
    const syncResults = [];

    for (const level of levels) {
      const insights = await fetchInsights({
        request,
        accountId,
        level,
        datePreset,
        limit,
        candidateLimit
      });

      const sourceMeta = {
        version: insights.version,
        start_time: insights.start_time,
        end_time: insights.end_time,
        attribution: insights.attribution,
        summary_source: insights.summary_source,
        scanned_entities: insights.scanned_entities,
        total_entities_available: insights.total_entities_available,
        partial_data: insights.partial_data
      };

      if (level === "overview") {
        insertedRows.push(
          normalizeMetricRow({
            workspaceId,
            accountId,
            metricDate,
            level: "account",
            row: {
              id: accountId,
              name: "Snapchat Account Overview",
              ...(insights.summary || {})
            },
            datePreset,
            sourceMeta
          })
        );
      } else {
        const rows = Array.isArray(insights.rows) ? insights.rows : [];

        for (const row of rows) {
          insertedRows.push(
            normalizeMetricRow({
              workspaceId,
              accountId,
              metricDate,
              level,
              row,
              datePreset,
              sourceMeta
            })
          );
        }
      }

      syncResults.push({
        level,
        success: true,
        rows: Array.isArray(insights.rows) ? insights.rows.length : 0,
        summary: insights.summary || {},
        source_version: insights.version
      });
    }

    const insertResult = await insertMetrics({
      admin,
      rows: insertedRows
    });

    const finishedAt = new Date().toISOString();

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-sync-to-supabase-v1",
      workspace_id: workspaceId,
      user_id: user.id,
      account_id: accountId,
      date_preset: datePreset,
      metric_date: metricDate,
      levels,
      inserted_rows: insertResult.inserted,
      started_at: startedAt,
      finished_at: finishedAt,
      results: syncResults
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "Snapchat Ads",
        version: "snapchat-sync-to-supabase-v1",
        error: error.message || "Snapchat sync failed"
      },
      { status: error.status || 500 }
    );
  }
}
