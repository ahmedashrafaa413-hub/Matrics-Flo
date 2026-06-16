import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";
const BASE = "https://adsapi.snapchat.com/v1";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id");
  const preset    = searchParams.get("preset") || "last_7d";

  const token = await getSnapchatToken();
  if (!token) return NextResponse.json({ error: "Not connected" });

  const now = new Date();
  function daysAgo(n) {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endStr = tomorrow.toISOString().split("T")[0];

  const presetMap = { today:0, yesterday:1, last_7d:6, last_30d:29, last_90d:89, maximum:1095 };
  const daysBack  = presetMap[preset] ?? 6;
  const startStr  = daysAgo(daysBack);

  const startTime = `${startStr}T00:00:00.000Z`;
  const endTime   = `${endStr}T00:00:00.000Z`;

  // 1. Get all campaigns
  const listRes  = await fetch(`${BASE}/adaccounts/${accountId}/campaigns?limit=50`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  const listData = await listRes.json();
  const camps    = listData.campaigns || [];

  // 2. Get stats for ALL campaigns (not just first 3)
  const campResults = [];
  for (const c of camps.slice(0, 10)) {
    const id     = c.campaign?.id;
    const name   = c.campaign?.name;
    const status = c.campaign?.status;
    const url    = `${BASE}/campaigns/${id}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${startTime}&end_time=${endTime}`;
    const res    = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data   = await res.json();
    const s      = data?.total_stats?.[0]?.total_stat?.stats || {};
    campResults.push({
      id, name, status,
      spend_usd:   Number(s.spend||0)/1e6,
      impressions: Number(s.impressions||0),
      swipes:      Number(s.swipes||0),
      purchases:   Number(s.conversion_purchases||0),
      revenue_usd: Number(s.conversion_purchases_value||0)/1e6,
    });
    await new Promise(r => setTimeout(r, 200));
  }

  // 3. Aggregate
  const total = campResults.reduce((acc, r) => {
    acc.spend   += r.spend_usd;
    acc.revenue += r.revenue_usd;
    acc.purchases += r.purchases;
    acc.impressions += r.impressions;
    acc.swipes += r.swipes;
    return acc;
  }, { spend:0, revenue:0, purchases:0, impressions:0, swipes:0 });

  // 4. Also try account-level with different org endpoint
  const orgRes  = await fetch(`${BASE}/adaccounts/${accountId}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  const orgData  = await orgRes.json();
  const orgId    = orgData?.adaccount?.organization_id;

  return NextResponse.json({
    preset, startTime, endTime,
    total_campaigns_in_account: camps.length,
    campaigns_checked: campResults.length,
    aggregated_totals: total,
    campaigns_with_spend: campResults.filter(r => r.spend_usd > 0),
    organization_id: orgId,
  });
}
