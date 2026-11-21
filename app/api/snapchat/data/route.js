import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { getActiveWorkspace, userHasWorkspaceAccess, getUserWorkspaces } from "../../../../lib/workspace";
import { requireUser } from "../../../../lib/serverAuth";
import { readSnapchatCache, riyadhToday } from "../../../../lib/snapchatCache.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const accountId = searchParams.get("account_id") || "";
    const datePreset = searchParams.get("date_preset") || "last_30d";
    const requestedLevel = searchParams.get("level") || "campaign";
    const metricDate = searchParams.get("metric_date") || riyadhToday();

    const page = Math.max(Number(searchParams.get("page") || 1), 1);
    const pageSize = Math.min(
      Math.max(Number(searchParams.get("page_size") || 50), 10),
      200
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

    // Support explicit workspace_id query param (used by MCP internal fetch to bypass
    // cookie-based workspace resolution, which does not work in server-to-server calls).
    let workspace;
    const explicitWorkspaceId = searchParams.get("workspace_id") || "";
    if (explicitWorkspaceId) {
      const user = await requireUser(request);
      const hasAccess = await userHasWorkspaceAccess(user.id, explicitWorkspaceId);
      if (!hasAccess) {
        return NextResponse.json({ success: false, error: "Workspace access denied" }, { status: 403 });
      }
      const workspaces = await getUserWorkspaces(user.id);
      workspace = workspaces.find(w => w.id === explicitWorkspaceId) || { id: explicitWorkspaceId };
    } else {
      const result = await getActiveWorkspace(request);
      workspace = result.workspace;
    }
    const cache = await readSnapchatCache(createSupabaseAdminClient(), {
      workspaceId: workspace.id,
      accountId,
      datePreset,
      level: requestedLevel,
      metricDate,
      page,
      pageSize
    });

    return NextResponse.json({
      success: true,
      provider: "Snapchat Ads",
      version: "snapchat-data-from-supabase-v2-paginated",
      source: "supabase_cache",
      workspace_id: workspace.id,
      account_id: accountId,
      level: requestedLevel,
      entity_level: cache.entity_level,
      date_preset: datePreset,
      metric_date: cache.metric_date,
      page: cache.page,
      page_size: cache.page_size,
      total_rows: cache.total_rows,
      loaded_rows: cache.loaded_rows,
      has_more: cache.has_more,
      last_synced_at: cache.last_synced_at,
      summary: cache.summary,
      rows: cache.rows,
      data: cache.rows,
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
