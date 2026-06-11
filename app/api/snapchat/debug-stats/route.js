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
      raw: text.slice(0, 1000)
    };
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const accountId = searchParams.get("account_id");
  const campaignId = searchParams.get("campaign_id");

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

  const listRes = await fetch(
    `${BASE}/adaccounts/${accountId}/campaigns?limit=3`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    }
  );

  const listResult = await readJsonResponse(listRes);
  const listData = listResult.data;

  const firstId =
    campaignId ||
    listData?.campaigns?.[0]?.campaign?.id ||
    null;

  let statsResult = null;

  if (firstId) {
    const start = new Date(
      Date.now() - 365 * 24 * 60 * 60 * 1000
    )
      .toISOString()
      .split("T")[0];

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const endTime =
      tomorrow.toISOString().split("T")[0] +
      "T00:00:00.000Z";

    const statsUrl =
      `${BASE}/campaigns/${firstId}/stats` +
      `?granularity=LIFETIME` +
      `&fields=impressions,spend,swipes` +
      `&start_time=${start}T00:00:00.000Z` +
      `&end_time=${endTime}`;

    const statsRes = await fetch(statsUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });

    statsResult = await readJsonResponse(statsRes);
    statsResult.url = statsUrl;
  }

  return NextResponse.json({
    success: true,
    accountId,
    firstCampaignId: firstId,
    campaignsStatus: listResult.status,
    campaignsOk: listResult.ok,
    listSample: listData?.campaigns?.slice(0, 2) || [],
    statsStatus: statsResult?.status || null,
    statsOk: statsResult?.ok || null,
    statsUrl: statsResult?.url || null,
    statsRawResponse: statsResult?.data || statsResult?.raw || null
  });
}
