import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

function getDateRange(range) {
  if (range === "today")
    return { startDate: "today", endDate: "today" };

  if (range === "yesterday")
    return { startDate: "yesterday", endDate: "yesterday" };

  if (range === "7daysAgo")
    return { startDate: "7daysAgo", endDate: "today" };

  if (range === "90daysAgo")
    return { startDate: "90daysAgo", endDate: "today" };

  return { startDate: "30daysAgo", endDate: "today" };
}

async function refreshGoogleToken(refreshToken) {
  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret:
          process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token"
      })
    }
  );

  return response.json();
}

export async function GET(request) {
  try {
    await requireUser(request);

    const { searchParams } = new URL(request.url);

    const range =
      searchParams.get("range") || "30daysAgo";

    const propertyIdFromQuery =
      searchParams.get("propertyId");

    const dateRange = getDateRange(range);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: connection } = await supabase
      .from("ga_connections")
      .select("*")
      .eq("user_id", "default_user")
      .single();

    const refreshed =
      await refreshGoogleToken(
        connection.refresh_token
      );

    const propertyId =
      propertyIdFromQuery ||
      connection.property_id;

    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshed.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          dateRanges: [dateRange],
          dimensions: [
            {
              name:
                "sessionDefaultChannelGroup"
            }
          ],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "conversions" }
          ],
          orderBys: [
            {
              metric: {
                metricName: "sessions"
              },
              desc: true
            }
          ],
          limit: 20
        })
      }
    );

    const data = await response.json();

    const channels =
      data.rows?.map((row) => ({
        channel:
          row.dimensionValues?.[0]?.value ||
          "Unknown",
        sessions: Number(
          row.metricValues?.[0]?.value || 0
        ),
        users: Number(
          row.metricValues?.[1]?.value || 0
        ),
        conversions: Number(
          row.metricValues?.[2]?.value || 0
        )
      })) || [];

    return NextResponse.json({
      success: true,
      property_id: propertyId,
      range,
      channels
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message
      },
      { status: error.status || 500 }
    );
  }
}
