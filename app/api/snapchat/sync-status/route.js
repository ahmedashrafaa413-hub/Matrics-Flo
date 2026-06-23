import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { getActiveWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "last_30d";
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
      .select("id, entity_level, updated_at, created_at")
      .eq("workspace_id", workspace.id)
      .eq("provider", "snapchat")
      .eq("account_id", accountId)
      .eq("metric_date", metricDate)
      .filter("raw->>date_preset", "eq", datePreset)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const rows = data || [];
    const latest = rows[0] || null;

    const counts = rows.reduce((acc, row) => {
      acc[row.entity_level] = (acc[row.entity_level] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-sync-status-v1",
      source: "platform_daily_metrics",
      workspace_id: workspace.id,
      account_id: accountId,
      date_preset: datePreset,
      metric_date: metricDate,
      has_cached_data: rows.length > 0,
      cached_rows: rows.length,
      counts,
      last_synced_at: latest?.updated_at || latest?.created_at || null
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        provider: "Snapchat Ads",
        version: "snapchat-sync-status-v1",
        error: error.message || "Failed to load Snapchat sync status"
      },
      { status: error.status || 500 }
    );
  }
}
