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

  // 1. Get adaccount info to find organization_id
  const accInfoRes  = await fetch(`${BASE}/adaccounts/${accountId}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  const accInfoData = await accInfoRes.json();
  const orgId       = accInfoData?.adaccount?.organization_id;
  const accCurrency = accInfoData?.adaccount?.currency;

  // 2. Try account-level stats
  const accStatsRes  = await fetch(
    `${BASE}/adaccounts/${accountId}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${startTime}&end_time=${endTime}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  const accStatsData = await accStatsRes.json();
  const accStats     = accStatsData?.total_stats?.[0]?.total_stat?.stats || {};

  // 3. Get ALL campaigns with pagination
  let allCamps = [];
  let nextLink = `${BASE}/adaccounts/${accountId}/campaigns?limit=200`;
  let pages = 0;
  while (nextLink && pages < 5) {
    const r = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const d = await r.json();
    allCamps = allCamps.concat(d.campaigns || []);
    nextLink = d.paging?.next_link || null;
    pages++;
  }

  // 4. Get stats for campaigns with spend — parallel batch of 50
  const BATCH = 50;
  const results = [];
  for (let i = 0; i < allCamps.length; i += BATCH) {
    const batch = allCamps.slice(i, i + BATCH);
    const br = await Promise.all(batch.map(async (c) => {
      const id = c.campaign?.id, name = c.campaign?.name, status = c.campaign?.status;
      try {
        const url  = `${BASE}/campaigns/${id}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${startTime}&end_time=${endTime}`;
        const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await res.json();
        const s    = data?.total_stats?.[0]?.total_stat?.stats || {};
        return { id, name, status, spend_usd: Number(s.spend||0)/1e6, impressions: Number(s.impressions||0), swipes: Number(s.swipes||0), purchases: Number(s.conversion_purchases||0), revenue_usd: Number(s.conversion_purchases_value||0)/1e6 };
      } catch { return { id, name, status, spend_usd: 0 }; }
    }));
    results.push(...br);
    if (i + BATCH < allCamps.length) await new Promise(r => setTimeout(r, 300));
  }

  const withSpend = results.filter(r => r.spend_usd > 0.001);
  const total = results.reduce((acc, r) => ({
    spend:    acc.spend    + r.spend_usd,
    revenue:  acc.revenue  + (r.revenue_usd||0),
    purchases: acc.purchases + (r.purchases||0),
    impressions: acc.impressions + (r.impressions||0),
    swipes: acc.swipes + (r.swipes||0),
  }), { spend:0, revenue:0, purchases:0, impressions:0, swipes:0 });

  return NextResponse.json({
    preset, startTime, endTime,
    organization_id: orgId,
    currency: accCurrency,
    // Account-level stats (if works)
    account_level_stats: {
      spend_usd:   Number(accStats.spend||0)/1e6,
      impressions: accStats.impressions,
      purchases:   accStats.conversion_purchases,
    },
    // Campaign aggregation
    total_campaigns_fetched: allCamps.length,
    campaigns_with_spend: withSpend.length,
    campaign_aggregated: total,
    // Top spenders
    top_campaigns: withSpend.sort((a,b) => b.spend_usd - a.spend_usd).slice(0, 10),
  });
}
