import { NextResponse } from "next/server";
import { buildConnectionStatus } from "../../../../lib/connectionStatus.mjs";
import { getActiveWorkspaceContext } from "../../../../lib/platformConnections";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { workspace } = await getActiveWorkspaceContext(request);
    const admin = createSupabaseAdminClient();

    const { data, error } = await admin
      .from("platform_connections")
      .select(
        "provider,account_id,account_name,account_currency,metadata,is_active,updated_at"
      )
      .eq("workspace_id", workspace.id)
      .eq("is_active", true)
      .in("provider", ["meta", "ga4", "salla", "snapchat"])
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({
      success: true,
      workspace_id: workspace.id,
      providers: buildConnectionStatus(data || [])
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to load connection status"
      },
      { status: error.status || 500 }
    );
  }
}
