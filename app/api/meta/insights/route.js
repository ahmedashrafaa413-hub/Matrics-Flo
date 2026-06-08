import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getTimeRange(datePreset) {
  const today = new Date();

  function formatDate(date) {
    return date.toISOString().split("T")[0];
  }

  const until = formatDate(today);
  const sinceDate = new Date(today);

  if (datePreset === "last_7d") {
    sinceDate.setDate(today.getDate() - 7);
    return {
      since: formatDate(sinceDate),
      until
    };
  }

  if (datePreset === "last_30d") {
    sinceDate.setDate(today.getDate() - 30);
    return {
      since: formatDate(sinceDate),
      until
    };
  }

  if (datePreset === "last_90d") {
    sinceDate.setDate(today.getDate() - 90);
    return {
      since: formatDate(sinceDate),
      until
    };
  }

  if (datePreset === "last_year") {
    sinceDate.setFullYear(today.getFullYear() - 1);
    return {
      since: formatDate(sinceDate),
      until
    };
  }

  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const token =
    searchParams.get("token") ||
    cookies().get("meta_token")?.value;

  const accountId = searchParams.get("account_id");
  const level = searchParams.get("level") || "campaign";
  const datePreset =
    searchParams.get("date_preset") || "last_30d";

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
    limit: "200",
    access_token: token
  });

  const timeRange = getTimeRange(datePreset);

  if (datePreset === "maximum") {
    params.set("date_preset", "maximum");
  } else if (timeRange) {
    params.set("time_range", JSON.stringify(timeRange));
  } else {
    params.set("date_preset", datePreset);
  }

  const url =
    `https://graph.facebook.com/v19.0/${accountId}/insights?` +
    params.toString();

  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();

  if (data.error) {
    return NextResponse.json(
      {
        success: false,
        error: data.error,
        debug_url: url.replace(token, "TOKEN_HIDDEN")
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
}
