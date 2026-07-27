import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";
const BASE = "https://adsapi.snapchat.com/v1";

export async function GET(request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id");
  const preset    = searchParams.get("preset") || "last_7d";

  const token = await getSnapchatToken(request);
  if (!token) return NextResponse.json({ error: "Not connected" });

  const now = new Date();
  function daysAgo(n) {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }
  const todayStr    = now.toISOString().split("T")[0];
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().split("T")[0];

  const startMap = {
    today:     todayStr,
    yesterday: daysAgo(1),
    last_7d:   daysAgo(7),
    last_30d:  daysAgo(30),
    last_90d:  daysAgo(90),
    maximum:   daysAgo(1095),
  };
  const endMap = {
    today:     tomorrowStr,
    yesterday: todayStr,
    last_7d:   todayStr,
    last_30d:  todayStr,
    last_90d:  todayStr,
    maximum:   todayStr,
  };

  const startStr = startMap[preset] || startMap.last_7d;
  const endStr   = endMap[preset]   || endMap.last_7d;
  const startTime = `${startStr}T00:00:00.000Z`;
  const endTime   = `${endStr}T00:00:00.000Z`;

  // Get ALL campaigns with pagination
  let allCamps = [];
  let nextUrl  = `${BASE}/adaccounts/${accountId}/campaigns?limit=200`;
  let pages    = 0;
  while (nextUrl && pages < 10) {
    const r = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const d = await r.json();
    allCamps = allCamps.concat(d.campaigns || []);
    nextUrl  = d.paging?.next_link || null;
    pages++;
  }

  // Get stats for ALL in parallel batches of 50
  const results = [];
  for (let i = 0; i < allCamps.length; i += 50) {
    const batch = allCamps.slice(i, i + 50);
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
    if (i + 50 < allCamps.length) await new Promise(r => setTimeout(r, 300));
  }

  const withSpend = results.filter(r => r.spend_usd > 0.001).sort((a,b) => b.spend_usd - a.spend_usd);
  const total = results.reduce((acc, r) => ({
    spend: acc.spend + r.spend_usd,
    revenue: acc.revenue + (r.revenue_usd||0),
    purchases: acc.purchases + (r.purchases||0),
    impressions: acc.impressions + (r.impressions||0),
    swipes: acc.swipes + (r.swipes||0),
  }), { spend:0, revenue:0, purchases:0, impressions:0, swipes:0 });

  return NextResponse.json({
    preset, startTime, endTime,
    total_campaigns: allCamps.length,
    with_spend: withSpend.length,
    aggregated: total,
    top_campaigns: withSpend.slice(0, 10),
  });
}
