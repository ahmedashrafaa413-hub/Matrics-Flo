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

  const { data: connection } = await supabase
    .from("salla_connections")
    .select("store_name, merchant_id")
    .eq("user_id", "default_user")
    .single();

  const { data: orders, error } = await supabase
    .from("salla_orders")
    .select("order_id,total_amount,currency,order_status,order_date")
    .eq("user_id", "default_user");

  if (error) {
    return NextResponse.json(
      { success: false, error },
      { status: 500 }
    );
  }

  const totalOrders = orders?.length || 0;
  const totalRevenue = (orders || []).reduce(
    (sum, order) => sum + Number(order.total_amount || 0),
    0
  );

  const averageOrderValue = totalOrders ? totalRevenue / totalOrders : 0;

  return NextResponse.json({
    success: true,
    store_name: connection?.store_name || "Salla Store",
    merchant_id: connection?.merchant_id || null,
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    average_order_value: averageOrderValue,
    currency: orders?.[0]?.currency || "SAR",
    orders: orders || []
  });
}
