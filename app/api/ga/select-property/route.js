import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request) {
  const body = await request.json();

  const { property_id, property_name } =
    body;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { error } = await supabase
    .from("ga_connections")
    .update({
      property_id,
      property_name
    })
    .eq("user_id", "default_user");

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error
      },
      {
        status: 500
      }
    );
  }

  return NextResponse.json({
    success: true
  });
}
