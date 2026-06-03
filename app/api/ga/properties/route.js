import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: connection, error } = await supabase
    .from("ga_connections")
    .select("*")
    .eq("user_id", "default_user")
    .single();

  if (error || !connection?.access_token) {
    return NextResponse.json(
      { success: false, error: "Google Analytics is not connected" },
      { status: 401 }
    );
  }

  const res = await fetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { success: false, step: "ga_properties", error: data },
      { status: res.status }
    );
  }

  const properties =
    data.accountSummaries?.flatMap((account) =>
      account.propertySummaries?.map((property) => ({
        account: account.displayName,
        property_id: property.property.replace("properties/", ""),
        property_name: property.displayName
      })) || []
    ) || [];

  return NextResponse.json({
    success: true,
    properties
  });
}
