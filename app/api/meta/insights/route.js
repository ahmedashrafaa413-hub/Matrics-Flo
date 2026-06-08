import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const token =
      searchParams.get("token") ||
      cookies().get("meta_token")?.value;

    const accountId = searchParams.get("account_id");
    const level = searchParams.get("level") || "campaign";
    const datePreset = searchParams.get("date_preset") || "maximum";

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Not connected to Meta" },
        { status: 401 }
      );
    }

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: "account_id is required" },
        { status: 400 }
      );
    }

    const fields = [
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
      "spend",
      "impressions",
      "reach",
      "frequency",
      "clicks",
      "inline_link_clicks",
      "ctr",
      "cpc",
      "cpm",
      "actions",
      "purchase_roas",
      "date_start",
      "date_stop"
    ].join(",");

    const params = new URLSearchParams({
      fields,
      level,
      date_preset: datePreset,
      limit: "200",
      access_token: token
    });

    const url = `https://graph.facebook.com/v19.0/${accountId}/insights?${params.toString()}`;

    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();

    if (data.error) {
      return NextResponse.json(
        {
          success: false,
          error: data.error
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      provider: "Meta Ads",
      account_id: accountId,
      level,
      date_preset: datePreset,
      data: data.data || [],
      paging: data.paging || null
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Internal server error"
      },
      { status: 500 }
    );
  }
}
