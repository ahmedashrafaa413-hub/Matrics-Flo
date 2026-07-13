import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../../../lib/supabaseServer";
import { requireUser } from "../../../../lib/serverAuth";
import { getSallaConnection } from "../../../../lib/sallaToken";

export const dynamic = "force-dynamic";

function getDateFilter(preset) {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
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

function orderDateOnly(order) {
  const raw = order.order_date || "";
  return String(raw).slice(0, 10);
}

// Salla's order line items can show up under a few different keys/shapes
// depending on API version — read defensively rather than assuming one.
function extractLineItems(order) {
  const raw = order.raw_data || {};
  const items = raw.items || raw.products || raw.order_items || [];

  if (!Array.isArray(items)) return [];

  return items.map((item) => ({
    name:
      item.product?.name ||
      item.name ||
      item.product_name ||
      "Unnamed product",
    quantity: Number(item.quantity || item.qty || 1),
    revenue: Number(
      item.amounts?.total?.amount ||
      item.total?.amount ||
      item.total_price ||
      item.price ||
      0
    )
  }));
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
  const datePreset = searchParams.get("date_range") || searchParams.get("date_preset") || "last_30d";

  const { workspace, connection } = await getSallaConnection(request);

  if (!connection) {
    return NextResponse.json(
      { success: false, error: "NOT_CONNECTED" },
      { status: 401 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { from, to } = getDateFilter(datePreset);

  let query = admin
    .from("salla_orders")
    .select("order_id,total_amount,currency,order_status,order_date,raw_data")
    .eq("workspace_id", workspace.id);

  if (datePreset !== "maximum") {
    query = query
      .gte("order_date", from + "T00:00:00")
      .lte("order_date", to + "T23:59:59");
  }

  const { data: orders, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const rows = orders || [];

  const totalRevenue = rows.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const totalOrders = rows.length;

  const dailyMap = {};
  const statusMap = {};
  const productMap = {};

  for (const order of rows) {
    const date = orderDateOnly(order);

    if (date) {
      if (!dailyMap[date]) dailyMap[date] = { date, revenue: 0, orders: 0 };
      dailyMap[date].revenue += Number(order.total_amount || 0);
      dailyMap[date].orders += 1;
    }

    const status = order.order_status || "Unknown";
    statusMap[status] = (statusMap[status] || 0) + 1;

    for (const item of extractLineItems(order)) {
      if (!productMap[item.name]) {
        productMap[item.name] = { name: item.name, quantity: 0, revenue: 0 };
      }
      productMap[item.name].quantity += item.quantity;
      productMap[item.name].revenue += item.revenue;
    }
  }

  const dailyRevenue = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  const topProducts = Object.values(productMap)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return NextResponse.json({
    success: true,
    store: connection.account_name,
    merchant_id: connection.metadata?.merchant_id || null,
    date_range: { from, to },
    totals: {
      revenue: totalRevenue,
      orders: totalOrders,
      avg_order_value: totalOrders ? totalRevenue / totalOrders : 0,
      products_count: Object.keys(productMap).length
    },
    daily_revenue: dailyRevenue,
    top_products: topProducts,
    status_breakdown: statusMap
  });
}
