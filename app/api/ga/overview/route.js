import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { getGaConnection } from "../../../../lib/gaToken";
import { fetchGa4Overview } from "../../../../lib/ga4Overview.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await requireUser(request);

    const { searchParams } = new URL(request.url);

    const range = searchParams.get("range") || "30daysAgo";
    const propertyIdFromQuery = searchParams.get("propertyId");

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

    const report = await fetchGa4Overview({
      accessToken: connection.access_token,
      propertyId,
      range
    });

    if (!report.ok) {
      return NextResponse.json({
        success: false,
        step: "ga_overview",
        property_id: propertyId,
        status: report.status,
        error: report.data
      });
    }

    return NextResponse.json({
      success: true,
      property_id: propertyId,
      property_name: propertyIdFromQuery ? null : propertyName,
      range,
      dateRange: report.dateRange,
      metrics: report.metrics
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
