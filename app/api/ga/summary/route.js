import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { getGaConnection } from "../../../../lib/gaToken";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await requireUser(request);
  } catch (authError) {
    return NextResponse.json(
      { success: false, error: authError.message || "Unauthorized" },
      { status: authError.status || 401 }
    );
  }

  const { connection, propertyId } = await getGaConnection(request);

  if (!connection) {
    return NextResponse.json({
      success: false,
      step: "supabase_read"
    });
  }

  if (!propertyId) {
    return NextResponse.json({
      success: false,
      step: "missing_data",
      has_refresh_token: Boolean(connection.refresh_token),
      property_id: propertyId
    });
  }

  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
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
    property_id: propertyId,
    data
  });
}
