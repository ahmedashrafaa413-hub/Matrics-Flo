import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

async function refreshGoogleToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  return res.json();
}

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

  if (error || !connection?.refresh_token) {
    return NextResponse.json(
      {
        success: false,
        step: "missing_connection",
        error
      },
      { status: 401 }
    );
  }

  const refreshed = await refreshGoogleToken(connection.refresh_token);

  if (!refreshed.access_token) {
    return NextResponse.json(
      {
        success: false,
        step: "refresh_token",
        error: refreshed
      },
      { status: 401 }
    );
  }

  await supabase
    .from("ga_connections")
    .update({
      access_token: refreshed.access_token,
      expires_at: new Date(
        Date.now() + Number(refreshed.expires_in || 3600) * 1000
      ).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("user_id", "default_user");

  const response = await fetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    {
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
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
        const propertyId = property.property.replace("properties/", "");

        return {
          id: propertyId,
          name: property.displayName,
          account_name: account.displayName,
          property_id: propertyId,
          property_name: property.displayName
        };
      }) || []
    ) || [];

  return NextResponse.json({
    success: true,
    selected_property_id: connection.property_id,
    selected_property_name: connection.property_name,
    properties
  });
}
