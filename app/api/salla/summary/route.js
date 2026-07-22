import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { requireUser } from "../../../../lib/serverAuth";
import { getSallaConnection } from "../../../../lib/sallaToken";
import { getRiyadhDateRange } from "../../../../lib/riyadhDateRange.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await requireUser(request);
  } catch (authError) {
    return NextResponse.json(
      { success: false, error: authError.message || "Unauthorized" },
      { status: authError.status || 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const datePreset = searchParams.get("date_preset") || "last_30d";

  const { workspace, connection } = await getSallaConnection(request);

  if (!connection) {
    return NextResponse.json(
      { success: false, error: "NOT_CONNECTED" },
      { status: 401 }
    );
  }

  const admin = createSupabaseAdminClient();

  // Build date-filtered query
  const { from, to, fromTimestamp, toExclusiveTimestamp } =
    getRiyadhDateRange(datePreset);

  let query = admin
    .from("salla_orders")
    .select("order_id,total_amount,currency,order_status,order_date")
    .eq("workspace_id", workspace.id);

  if (datePreset !== "maximum") {
    query = query
      .gte("order_date", fromTimestamp)
      .lt("order_date", toExclusiveTimestamp);
  }

  const { data: orders, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error }, { status: 500 });
  }

  const totalOrders   = orders?.length || 0;
  const totalRevenue  = (orders || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const averageOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

  return NextResponse.json({
    success: true,
    store_name: connection?.account_name || "Salla Store",
    merchant_id: connection?.metadata?.merchant_id || null,
    date_preset: datePreset,
    date_range: { from, to },
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    average_order_value: averageOrderValue,
    currency: orders?.[0]?.currency || "SAR",
    orders: orders || []
  });
}
