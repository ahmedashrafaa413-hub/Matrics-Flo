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

  // Simple UTC dates — same as the debug route that WORKS
  const now = new Date();
  function daysAgo(n) {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
  }
  // end = tomorrow but only +1 from TODAY (not daysBack)
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const endStr   = tomorrow.toISOString().split("T")[0];

  const presetMap = { today:0, yesterday:1, last_7d:6, last_30d:29, last_90d:89, maximum:1095 };
  const daysBack  = presetMap[preset] ?? 6;
  const startStr  = daysAgo(daysBack);

  // Test 3 different URL formats
  async function tryUrl(label, startTime, endTime) {
    const url = `${BASE}/adaccounts/${accountId}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await res.json();
    const s    = data?.total_stats?.[0]?.total_stat?.stats || {};
    return { label, startTime, endTime, status: res.status, spend_usd: Number(s.spend||0)/1e6, impressions: s.impressions, purchases: s.conversion_purchases };
  }

  // Also try campaign level for first campaign
  const listRes  = await fetch(`${BASE}/adaccounts/${accountId}/campaigns?limit=5`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const listData = await listRes.json();
  const camps    = (listData.campaigns || []).slice(0, 3);

  const campResults = [];
  for (const c of camps) {
    const id     = c.campaign?.id;
    const name   = c.campaign?.name;
    const status = c.campaign?.status;
    // Use maximum range to see if there's ANY data
    const url = `${BASE}/campaigns/${id}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${startStr}T00:00:00.000Z&end_time=${endStr}T00:00:00.000Z`;
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await res.json();
    const s    = data?.total_stats?.[0]?.total_stat?.stats || {};
    campResults.push({ id, name, status, spend_usd: Number(s.spend||0)/1e6, impressions: s.impressions, purchases: s.conversion_purchases, revenue_usd: Number(s.conversion_purchases_value||0)/1e6 });
  }

  const [fmtA, fmtB, fmtC] = await Promise.all([
    tryUrl("UTC_no_time",    `${startStr}`,                             `${endStr}`),
    tryUrl("UTC_with_Z",     `${startStr}T00:00:00.000Z`,              `${endStr}T00:00:00.000Z`),
    tryUrl("UTC_plus3",      `${startStr}T00:00:00.000+03:00`,         `${endStr}T00:00:00.000+03:00`),
  ]);

  return NextResponse.json({
    preset, daysBack,
    startStr, endStr,
    now_utc: now.toISOString(),
    account_level_formats: [fmtA, fmtB, fmtC],
    campaign_level_7d: campResults,
  });
}
