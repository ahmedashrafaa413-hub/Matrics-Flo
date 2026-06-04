import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

  if (!connection?.refresh_token || !connection?.property_id) {
    return NextResponse.json({
      success: false,
      error: "GA not connected"
    });
  }

  const refreshed = await refreshGoogleToken(
    connection.refresh_token
  );

  if (!refreshed.access_token) {
    return NextResponse.json({
      success: false,
      error: refreshed
    });
  }

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

        dimensions: [
          {
            name: "pagePath"
          }
        ],

        metrics: [
          {
            name: "screenPageViews"
          },
          {
            name: "sessions"
          }
        ],

        orderBys: [
          {
            metric: {
              metricName: "screenPageViews"
            },
            desc: true
          }
        ],

        limit: 20
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json({
      success: false,
      error: data
    });
  }

  const pages =
    data.rows?.map((row) => ({
      page: row.dimensionValues?.[0]?.value,
      views: Number(row.metricValues?.[0]?.value || 0),
      sessions: Number(row.metricValues?.[1]?.value || 0)
    })) || [];

  return NextResponse.json({
    success: true,
    property_id: connection.property_id,
    property_name: connection.property_name,
    pages
  });
}
