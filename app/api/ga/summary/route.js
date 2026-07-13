import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

async function refreshGoogleToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  return res.json();
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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: connection, error } = await supabase
    .from("ga_connections")
    .select("*")
    .eq("user_id", "default_user")
    .single();

  if (error || !connection) {
    return NextResponse.json({
      success: false,
      step: "supabase_read",
      error
    });
  }

  if (!connection.refresh_token || !connection.property_id) {
    return NextResponse.json({
      success: false,
      step: "missing_data",
      has_refresh_token: Boolean(connection.refresh_token),
      property_id: connection.property_id,
      property_name: connection.property_name
    });
  }

  const refreshed = await refreshGoogleToken(connection.refresh_token);

  if (!refreshed.access_token) {
    return NextResponse.json({
      success: false,
      step: "refresh_token",
      error: refreshed
    });
  }

  await supabase
    .from("ga_connections")
    .update({
      access_token: refreshed.access_token,
      expires_at: new Date(
        Date.now() + Number(refreshed.expires_in || 3600) * 1000
      ).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("user_id", "default_user");

  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${connection.property_id}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
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

  if (!response.ok) {
    return NextResponse.json({
      success: false,
      step: "ga_run_report",
      status: response.status,
      error: data
    });
  }

  return NextResponse.json({
    success: true,
    property_id: connection.property_id,
    property: connection.property_name,
    data
  });
}
