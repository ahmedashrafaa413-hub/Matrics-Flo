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

  let connection, propertyId, propertyName;

  try {
    ({ connection, propertyId, propertyName } = await getGaConnection(request));
  } catch (error) {
    return NextResponse.json(
      { success: false, step: "refresh_token", error: error.message },
      { status: 401 }
    );
  }

  if (!connection) {
    return NextResponse.json(
      { success: false, step: "missing_connection" },
      { status: 401 }
    );
  }

  const response = await fetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      {
        success: false,
        step: "ga_properties",
        status: response.status,
        error: data
      },
      { status: response.status }
    );
  }

  const properties =
    data.accountSummaries?.flatMap((account) =>
      account.propertySummaries?.map((property) => {
        const id = property.property.replace("properties/", "");

        return {
          id,
          name: property.displayName,
          account_name: account.displayName,
          property_id: id,
          property_name: property.displayName
        };
      }) || []
    ) || [];

  return NextResponse.json({
    success: true,
    selected_property_id: propertyId,
    selected_property_name: propertyName,
    properties
  });
}
