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

  // Get ALL campaigns
  const listRes  = await fetch(`${BASE}/adaccounts/${accountId}/campaigns?limit=200`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  const listData = await listRes.json();
  const camps    = listData.campaigns || [];

  // Get stats for ALL in parallel batches of 25
  const BATCH = 25;
  const results = [];

  for (let i = 0; i < camps.length; i += BATCH) {
    const batch = camps.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(async (c) => {
      const id     = c.campaign?.id;
      const name   = c.campaign?.name;
      const status = c.campaign?.status;
      try {
        const url  = `${BASE}/campaigns/${id}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${startTime}&end_time=${endTime}`;
        const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await res.json();
        const s    = data?.total_stats?.[0]?.total_stat?.stats || {};
        return { id, name, status, spend_usd: Number(s.spend||0)/1e6, impressions: Number(s.impressions||0), swipes: Number(s.swipes||0), purchases: Number(s.conversion_purchases||0), revenue_usd: Number(s.conversion_purchases_value||0)/1e6 };
      } catch {
        return { id, name, status, spend_usd: 0, error: true };
      }
    }));
    results.push(...batchResults);
    if (i + BATCH < camps.length) await new Promise(r => setTimeout(r, 200));
  }

  const withSpend = results.filter(r => r.spend_usd > 0);
  const total = results.reduce((acc, r) => {
    acc.spend    += r.spend_usd;
    acc.revenue  += r.revenue_usd || 0;
    acc.purchases += r.purchases || 0;
    acc.impressions += r.impressions || 0;
    acc.swipes   += r.swipes || 0;
    return acc;
  }, { spend:0, revenue:0, purchases:0, impressions:0, swipes:0 });

  return NextResponse.json({
    preset, startTime, endTime,
    total_campaigns: camps.length,
    checked: results.length,
    with_spend_count: withSpend.length,
    aggregated_total: total,
    campaigns_with_spend: withSpend,
  });
}
