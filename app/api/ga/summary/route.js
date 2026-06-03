import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: connection } = await supabase
    .from("ga_connections")
    .select("*")
    .eq("user_id", "default_user")
    .single();

  if (!connection?.access_token || !connection?.property_id) {
    return NextResponse.json({
      success: false,
      error: "GA not connected"
    });
  }

  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${connection.property_id}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dateRanges: [
          {
            startDate: "30daysAgo",
            endDate: "today"
          }
        ],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "conversions" }
        ]
      })
    }
  );

  const data = await response.json();

  return NextResponse.json({
    success: true,
    property: connection.property_name,
    data
  });
}
