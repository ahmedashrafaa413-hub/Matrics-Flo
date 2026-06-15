import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";
const BASE = "https://adsapi.snapchat.com/v1";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id");
  const preset    = searchParams.get("preset") || "today";

  const token = await getSnapchatToken();
  if (!token) return NextResponse.json({ error: "Not connected" });

  const now     = new Date();
  const today   = now.toISOString().split("T")[0];
  const tmrw    = new Date(now); tmrw.setUTCDate(tmrw.getUTCDate()+1);
  const endTime = tmrw.toISOString().split("T")[0] + "T00:00:00.000Z";
  function daysAgo(n) { const d=new Date(now); d.setUTCDate(d.getUTCDate()-n); return d.toISOString().split("T")[0]; }
  const startMap = { today, yesterday:daysAgo(1), last_7d:daysAgo(6), last_30d:daysAgo(29), maximum:daysAgo(1095) };
  const startTime = (startMap[preset]||startMap.last_30d)+"T00:00:00.000Z";

  // Account summary
  const accRes  = await fetch(`${BASE}/adaccounts/${accountId}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${startTime}&end_time=${endTime}`, { headers:{Authorization:`Bearer ${token}`}, cache:"no-store" });
  const accData = await accRes.json();
  const accStats = accData?.total_stats?.[0]?.total_stat?.stats || accData?.total_stats?.[0]?.stats || {};

  // Campaigns list + first 3 stats
  const listRes  = await fetch(`${BASE}/adaccounts/${accountId}/campaigns?limit=20`, { headers:{Authorization:`Bearer ${token}`}, cache:"no-store" });
  const listData = await listRes.json();
  const camps    = (listData.campaigns||[]).slice(0,3);

  const campStats = [];
  for (const c of camps) {
    const id   = c.campaign?.id;
    const name = c.campaign?.name;
    const stat = await fetch(`${BASE}/campaigns/${id}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${startTime}&end_time=${endTime}`, { headers:{Authorization:`Bearer ${token}`}, cache:"no-store" });
    const sd   = await stat.json();
    const s    = sd?.total_stats?.[0]?.total_stat?.stats || {};
    campStats.push({ id, name, raw_spend: s.spend, spend_usd: Number(s.spend||0)/1e6, impressions: s.impressions, purchases: s.conversion_purchases, revenue_usd: Number(s.conversion_purchases_value||0)/1e6 });
  }

  return NextResponse.json({
    preset, startTime, endTime,
    account_summary: { raw_spend: accStats.spend, spend_usd: Number(accStats.spend||0)/1e6, impressions: accStats.impressions, purchases: accStats.conversion_purchases, revenue_usd: Number(accStats.conversion_purchases_value||0)/1e6 },
    campaign_samples: campStats,
  });
}
