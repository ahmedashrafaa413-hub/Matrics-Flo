import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "../../../../lib/serverAuth";

export const dynamic = "force-dynamic";

function getDateRange(range) {
  if (range === "today") {
    return { startDate: "today", endDate: "today" };
  }

  if (range === "yesterday") {
    return { startDate: "yesterday", endDate: "yesterday" };
  }

  if (range === "7daysAgo") {
    return { startDate: "7daysAgo", endDate: "today" };
  }

  if (range === "90daysAgo") {
    return { startDate: "90daysAgo", endDate: "today" };
  }

  return { startDate: "30daysAgo", endDate: "today" };
}

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

    const { searchParams } = new URL(request.url);

    const range = searchParams.get("range") || "30daysAgo";
    const propertyIdFromQuery = searchParams.get("propertyId");

    const dateRange = getDateRange(range);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: connection, error } = await supabase
      .from("ga_connections")
      .select("*")
      .eq("user_id", "default_user")
      .single();

    if (error || !connection?.refresh_token) {
      return NextResponse.json({
        success: false,
        step: "missing_connection",
        error
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

    const propertyId =
      propertyIdFromQuery || connection.property_id;

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
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "screenPageViews" },
            { name: "conversions" },
            { name: "engagementRate" },
            { name: "bounceRate" },
            { name: "averageSessionDuration" }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        step: "ga_overview",
        property_id: propertyId,
        status: response.status,
        error: data
      });
    }

    const values = data.rows?.[0]?.metricValues || [];

    const sessions = Number(values[0]?.value || 0);
    const users = Number(values[1]?.value || 0);
    const pageViews = Number(values[2]?.value || 0);
    const conversions = Number(values[3]?.value || 0);

    const engagementRate = Number(values[4]?.value || 0) * 100;
    const bounceRate = Number(values[5]?.value || 0) * 100;
    const averageSessionDuration = Number(values[6]?.value || 0);

    const conversionRate =
      sessions > 0 ? (conversions / sessions) * 100 : 0;

    return NextResponse.json({
      success: true,
      property_id: propertyId,
      property_name: propertyIdFromQuery ? null : connection.property_name,
      range,
      dateRange,
      metrics: {
        sessions,
        users,
        pageViews,
        conversions,
        conversionRate: Number(conversionRate.toFixed(2)),
        engagementRate: Number(engagementRate.toFixed(2)),
        bounceRate: Number(bounceRate.toFixed(2)),
        averageSessionDuration: Number(averageSessionDuration.toFixed(2))
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        step: "internal_error",
        error: error?.message || "Internal server error"
      },
      { status: error.status || 500 }
    );
  }
}
