import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { requireUser } from "../../../../lib/serverAuth";
import { getSallaConnection } from "../../../../lib/sallaToken";

export const dynamic = "force-dynamic";

function getDateFilter(preset) {
  const now = new Date();
  const pad = n => String(n).padStart(2,"0");
  function daysAgo(n) {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }
  const today = now.toISOString().split("T")[0];
  const map = {
    today:      { from: today,          to: today },
    yesterday:  { from: daysAgo(1),     to: daysAgo(1) },
    last_7d:    { from: daysAgo(6),     to: today },
    last_30d:   { from: daysAgo(29),    to: today },
    this_month: { from: `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`, to: today },
    last_90d:   { from: daysAgo(89),    to: today },
    maximum:    { from: "2000-01-01",   to: today },
  };
  return map[preset] || map.last_30d;
}

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

  const { user, connection } = await getSallaConnection(request);

  const admin = createSupabaseAdminClient();

  // Build date-filtered query
  const { from, to } = getDateFilter(datePreset);

  let query = admin
    .from("salla_orders")
    .select("order_id,total_amount,currency,order_status,order_date")
    .eq("user_id", user.id);

  if (datePreset !== "maximum") {
    query = query
      .gte("order_date", from + "T00:00:00")
      .lte("order_date", to + "T23:59:59");
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
