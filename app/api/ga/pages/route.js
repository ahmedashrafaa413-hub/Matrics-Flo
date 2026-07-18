import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { getGaConnection } from "../../../../lib/gaToken";

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

export async function GET(request) {
  try {
    await requireUser(request);
  } catch (authError) {
    return NextResponse.json(
      { success: false, error: authError.message || "Unauthorized" },
      { status: authError.status || 401 }
    );
  }

  const { searchParams } = new URL(request.url);

  const range = searchParams.get("range") || "30daysAgo";
  const propertyIdFromQuery = searchParams.get("propertyId");

  const dateRange = getDateRange(range);

  const { connection, propertyId: selectedPropertyId, propertyName } =
    await getGaConnection(request);

  if (!connection) {
    return NextResponse.json({
      success: false,
      step: "missing_connection"
    });
  }

  const propertyId = propertyIdFromQuery || selectedPropertyId;

  if (!propertyId) {
    return NextResponse.json({
      success: false,
      step: "missing_property"
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
        dateRanges: [dateRange],
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
      step: "ga_pages",
      status: response.status,
      error: data
    });
  }

  const pages =
    data.rows?.map((row) => ({
      page: row.dimensionValues?.[0]?.value || "Unknown",
      views: Number(row.metricValues?.[0]?.value || 0),
      sessions: Number(row.metricValues?.[1]?.value || 0)
    })) || [];

  return NextResponse.json({
    success: true,
    property_id: propertyId,
    property_name: propertyName,
    range,
    dateRange,
    pages
  });
}
