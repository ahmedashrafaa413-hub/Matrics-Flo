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

  return NextResponse.json({
    success: true,
    store: connection.store_name,
    merchant_id: connection.merchant_id,
    data: ordersData.data || ordersData
  });
}
