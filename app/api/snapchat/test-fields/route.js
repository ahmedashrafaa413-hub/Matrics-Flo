import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return {
      ok: response.ok,
      status: response.status,
      data: JSON.parse(text),
      raw: null
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      raw: text.slice(0, 1500)
    };
  }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const accountId = searchParams.get("account_id");
  const campaignId = searchParams.get("campaign_id");
  const entityType = searchParams.get("entity_type") || "campaigns";
  const fields =
    searchParams.get("fields") || "impressions,spend,swipes";

  const token = await getSnapchatToken();

  if (!token) {
    return NextResponse.json({
      success: false,
      error: "Not connected to Snapchat"
    });
  }

  if (!accountId) {
    return NextResponse.json({
      success: false,
      error: "account_id is required"
    });
  }

  let entityId = campaignId || null;
  let listResult = null;

  if (!entityId) {
    const listUrl = `${BASE}/adaccounts/${accountId}/campaigns?limit=1`;

    const listRes = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });

    listResult = await readJsonResponse(listRes);

    if (!listResult.ok) {
      return NextResponse.json({
        success: false,
        step: "entity_list",
        status: listResult.status,
        error: listResult.data || listResult.raw
      });
    }

    entityId =
      listResult.data?.campaigns?.[0]?.campaign?.id ||
      null;
  }

  if (!entityId) {
    return NextResponse.json({
      success: false,
      error: "No entity id found. Pass campaign_id manually."
    });
  }

  const startDate = daysAgo(1095);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const endTime =
    tomorrow.toISOString().split("T")[0] +
    "T00:00:00.000Z";

  const url =
    `${BASE}/${entityType}/${entityId}/stats` +
    `?granularity=TOTAL` +
    `&fields=${encodeURIComponent(fields)}` +
    `&start_time=${startDate}T00:00:00.000Z` +
    `&end_time=${endTime}`;

  const statsRes = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: "no-store"
  });

  const statsResult = await readJsonResponse(statsRes);

  return NextResponse.json({
    success: statsResult.ok,
    accountId,
    entityType,
    entityId,
    fields,
    status: statsResult.status,
    ok: statsResult.ok,
    url,
    response: statsResult.data || statsResult.raw
  });
}
