import { NextResponse } from "next/server";
import { requireUser } from "../../../../lib/serverAuth";
import { updateGaSelectedProperty } from "../../../../lib/gaToken";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await requireUser(request);
  } catch (authError) {
    return NextResponse.json(
      { success: false, error: authError.message || "Unauthorized" },
      { status: authError.status || 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const propertyId = body.property_id || body.propertyId || "";
  const propertyName = body.property_name || body.propertyName || "";

  if (!propertyId) {
    return NextResponse.json(
      { success: false, error: "property_id is required" },
      { status: 400 }
    );
  }

  try {
    await updateGaSelectedProperty(request, { propertyId, propertyName });
  } catch (error) {
    return NextResponse.json(
      { success: false, step: "supabase_update", error: error.message },
      { status: error.status || 500 }
    );
  }

  return NextResponse.json({
    success: true,
    property_id: propertyId,
    property_name: propertyName
  });
}
