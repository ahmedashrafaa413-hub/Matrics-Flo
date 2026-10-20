import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { requireUser } from "../../../../lib/serverAuth";
import { getSallaConnection } from "../../../../lib/sallaToken";
import { getRiyadhDateRange } from "../../../../lib/riyadhDateRange.mjs";
import { fetchAllRows, summarizeOrders } from "../../../../lib/sallaOrders.mjs";
import {
  DEFAULT_TIME_ZONE,
  shiftDate,
  zonedMidnight
} from "../../../../lib/reportingPeriod.mjs";

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

  // Same calendar days as Meta, Snapchat and GA4, in the workspace timezone.
  const preset = getRiyadhDateRange(datePreset, new Date(), workspace.timezone);
  let { from, to, fromTimestamp, toExclusiveTimestamp } = preset;

  // A custom range (since/until, inclusive) as used by the Meta page.
  const since = searchParams.get("since") || "";
  const until = searchParams.get("until") || "";
  const isCustom =
    /^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until) && since <= until;

  if (isCustom) {
    const zone = workspace.timezone || DEFAULT_TIME_ZONE;
    from = since;
    to = until;
    fromTimestamp = zonedMidnight(since, zone);
    toExclusiveTimestamp = zonedMidnight(shiftDate(until, 1), zone);
  }

  const buildQuery = () => {
    let query = admin
      .from("salla_orders")
      .select("order_id,total_amount,currency,order_status,order_date,status_slug:raw_data->status->>slug")
      .eq("workspace_id", workspace.id)
      .order("order_date", { ascending: false })
      .order("order_id", { ascending: true });

    if (isCustom || datePreset !== "maximum") {
      query = query
        .gte("order_date", fromTimestamp)
        .lt("order_date", toExclusiveTimestamp);
    }

    return query;
  };

  let orders;
  try {
    orders = await fetchAllRows(buildQuery);
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Cancelled, refunded and returned orders are listed but not counted.
  const {
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    average_order_value: averageOrderValue,
    excluded_orders: excludedOrders
  } = summarizeOrders(orders);

  return NextResponse.json({
    success: true,
    store_name: connection?.account_name || "Salla Store",
    merchant_id: connection?.metadata?.merchant_id || null,
    date_preset: isCustom ? "custom" : preset.preset,
    date_range: { from, to },
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    average_order_value: averageOrderValue,
    excluded_orders: excludedOrders,
    currency: orders?.[0]?.currency || "SAR"
  });
}
