import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId  = searchParams.get("account_id");
  const campaignId = searchParams.get("campaign_id");

  const token = await getSnapchatToken();
  if (!token) return NextResponse.json({ error: "Not connected" });

  // Get first campaign
  const listRes  = await fetch(`${BASE}/adaccounts/${accountId}/campaigns?limit=3`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  const listData = await listRes.json();
  const firstId  = campaignId || listData.campaigns?.[0]?.campaign?.id;

  let statsData = null;
  if (firstId) {
    const start = new Date(Date.now() - 365*24*60*60*1000).toISOString().split("T")[0];
    // end_time must be start of an hour — use tomorrow 00:00:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const endTime = tomorrow.toISOString().split("T")[0] + "T00:00:00.000Z";

    const statsRes = await fetch(
      `${BASE}/campaigns/${firstId}/stats`
        + `?granularity=LIFETIME`
        + `&fields=impressions,spend,swipes`
        + `&start_time=${start}T00:00:00.000Z`
        + `&end_time=${endTime}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    statsData = await statsRes.json();
  }

  return NextResponse.json({
    firstCampaignId: firstId,
    listSample: listData.campaigns?.slice(0, 2),
    statsRawResponse: statsData,
  });
}
