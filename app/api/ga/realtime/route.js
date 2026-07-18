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

  const { searchParams } = new URL(request.url);
  const propertyIdFromQuery = searchParams.get("propertyId");

  const { connection, propertyId: selectedPropertyId } = await getGaConnection(request);

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
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        metrics: [
          {
            name: "activeUsers"
          }
        ]
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json({
      success: false,
      step: "ga_realtime",
      property_id: propertyId,
      status: response.status,
      error: data
    });
  }

  return NextResponse.json({
    success: true,
    property_id: propertyId,
    realtime: data
  });
}
