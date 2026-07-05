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

  const token = await getSnapchatToken(request);

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

  let firstId = campaignId || null;
  let listResult = null;

  if (!firstId) {
    const campaignsUrl = `${BASE}/adaccounts/${accountId}/campaigns?limit=3`;

    const listRes = await fetch(campaignsUrl, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });

    listResult = await readJsonResponse(listRes);

    if (!listResult.ok) {
      return NextResponse.json({
        success: false,
        step: "campaigns_list",
        accountId,
        campaignsStatus: listResult.status,
        campaignsOk: listResult.ok,
        error:
          listResult.status === 429
            ? "Snapchat API rate limit reached. Wait 5 minutes."
            : "Failed to fetch campaigns",
        campaignsRawResponse: listResult.data || listResult.raw
      });
    }

    firstId = listResult.data?.campaigns?.[0]?.campaign?.id || null;
  }

  if (!firstId) {
    return NextResponse.json({
      success: false,
      error: "No campaign_id found. Pass campaign_id manually."
    });
  }

  const startDate = daysAgo(1095);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const endTime =
    tomorrow.toISOString().split("T")[0] +
    "T00:00:00.000Z";

  const tests = [
    {
      name: "TOTAL_BASIC",
      url:
        `${BASE}/campaigns/${firstId}/stats` +
        `?granularity=TOTAL` +
        `&fields=impressions,spend,swipes` +
        `&start_time=${startDate}T00:00:00.000Z` +
        `&end_time=${endTime}`
    }
  ];

  const results = [];

  for (const test of tests) {
    const res = await fetch(test.url, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });

    const result = await readJsonResponse(res);

    results.push({
      name: test.name,
      status: result.status,
      ok: result.ok,
      url: test.url,
      response: result.data || result.raw
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return NextResponse.json({
    success: true,
    accountId,
    campaignId: firstId,
    campaignsListStatus: listResult?.status || "skipped",
    results
  });
}
