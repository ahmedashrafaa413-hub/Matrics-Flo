import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

async function refreshGoogleToken(refreshToken) {
  const res = await fetch(
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

  return res.json();
}

export async function GET(request) {
  try {
    const searchParams =
      request.nextUrl.searchParams;

    const propertyIdFromQuery =
      searchParams.get("propertyId");

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: connection, error } =
      await supabase
        .from("ga_connections")
        .select("*")
        .eq("user_id", "default_user")
        .single();

    if (
      error ||
      !connection?.refresh_token
    ) {
      return NextResponse.json({
        success: false,
        error: "GA connection not found"
      });
    }

    const refreshed =
      await refreshGoogleToken(
        connection.refresh_token
      );

    if (!refreshed.access_token) {
      return NextResponse.json({
        success: false,
        error: refreshed
      });
    }

    const propertyId =
      propertyIdFromQuery ||
      connection.property_id;

    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshed.access_token}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify({
          dateRanges: [
            {
              startDate: "30daysAgo",
              endDate: "today"
            }
          ],
          metrics: [
            {
              name: "sessions"
            },
            {
              name: "totalUsers"
            },
            {
              name: "screenPageViews"
            },
            {
              name: "conversions"
            }
          ]
        })
      }
    );

    const data =
      await response.json();

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        property_id: propertyId,
        error: data
      });
    }

    const sessions = Number(
      data.rows?.[0]?.metricValues?.[0]
        ?.value || 0
    );

    const users = Number(
      data.rows?.[0]?.metricValues?.[1]
        ?.value || 0
    );

    const pageViews = Number(
      data.rows?.[0]?.metricValues?.[2]
        ?.value || 0
    );

    const conversions = Number(
      data.rows?.[0]?.metricValues?.[3]
        ?.value || 0
    );

    return NextResponse.json({
      success: true,
      property_id: propertyId,
      property_name:
        connection.property_name,
      metrics: {
        sessions,
        users,
        pageViews,
        conversions,
        conversionRate:
          sessions > 0
            ? (
                (conversions /
                  sessions) *
                100
              ).toFixed(2)
            : 0
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Internal server error"
      },
      {
        status: 500
      }
    );
  }
}
