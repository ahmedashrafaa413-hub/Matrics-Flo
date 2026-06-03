import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { success: false, error: "Missing Supabase environment variables" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: connection, error: connectionError } = await supabase
    .from("salla_connections")
    .select("*")
    .eq("user_id", "default_user")
    .single();

  if (connectionError || !connection?.access_token) {
    return NextResponse.json(
      { success: false, error: "Salla is not connected" },
      { status: 401 }
    );
  }

  const ordersRes = await fetch("https://api.salla.dev/admin/v2/orders", {
    headers: {
      Authorization: `Bearer ${connection.access_token}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const ordersData = await ordersRes.json();

  if (!ordersRes.ok) {
    return NextResponse.json(
      { success: false, step: "salla_orders", error: ordersData },
      { status: ordersRes.status }
    );
  }

  const orders = Array.isArray(ordersData.data) ? ordersData.data : [];

  const rows = orders.map((order) => ({
    user_id: connection.user_id || "default_user",
    order_id: String(order.id || order.reference_id),
    order_status: order.status?.name || order.status || null,
    total_amount: Number(order.total?.amount || order.amounts?.total?.amount || 0),
    currency:
      order.total?.currency ||
      order.amounts?.total?.currency ||
      order.currency ||
      "SAR",
    order_date:
      order.date?.date ||
      order.created_at?.date ||
      order.created_at ||
      null,
    raw_data: order,
    created_at: new Date().toISOString()
  }));

  if (rows.length) {
    const { error: saveError } = await supabase.from("salla_orders").upsert(
      rows,
      {
        onConflict: "user_id,order_id"
      }
    );

    if (saveError) {
      return NextResponse.json(
        { success: false, step: "supabase_orders_save", error: saveError },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    store: connection.store_name,
    merchant_id: connection.merchant_id,
    fetched_orders: orders.length,
    saved_orders: rows.length,
    data: rows
  });
}
