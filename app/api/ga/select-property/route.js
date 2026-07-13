import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "../../../../lib/serverAuth";

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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { error } = await supabase
    .from("ga_connections")
    .update({
      property_id: propertyId,
      property_name: propertyName,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", "default_user");

  if (error) {
    return NextResponse.json(
      { success: false, step: "supabase_update", error },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    property_id: propertyId,
    property_name: propertyName
  });
}
