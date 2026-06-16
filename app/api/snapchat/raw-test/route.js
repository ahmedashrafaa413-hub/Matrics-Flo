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

  // Method A: Pure UTC (same as debug route that works)
  function daysAgoUTC(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().split("T")[0];
  }
  const tmrwUTC = new Date();
  tmrwUTC.setUTCDate(tmrwUTC.getUTCDate() + 1);

  // Method B: UTC+3 offset timestamps
  const OFFSET_MS = 3 * 60 * 60 * 1000;
  const nowPlus3  = new Date(Date.now() + OFFSET_MS);
  function dateStrPlus3(d) {
    const s = new Date(d.getTime() + OFFSET_MS);
    return `${s.getUTCFullYear()}-${String(s.getUTCMonth()+1).padStart(2,"0")}-${String(s.getUTCDate()).padStart(2,"0")}`;
  }
  function daysAgoPlus3(n) {
    return dateStrPlus3(new Date(nowPlus3.getTime() - n * 86400000));
  }

  const presetMap = { today:0, yesterday:1, last_7d:6, last_30d:29, last_90d:89 };
  const daysBack  = presetMap[preset] || 6;

  const startUTC  = `${daysAgoUTC(daysBack)}T00:00:00.000Z`;
  const endUTC    = `${tmrwUTC.toISOString().split("T")[0]}T00:00:00.000Z`;

  const todayPlus3 = dateStrPlus3(nowPlus3);
  const tmrwPlus3  = dateStrPlus3(new Date(nowPlus3.getTime() + 86400000));
  const startPlus3 = `${daysAgoPlus3(daysBack)}T00:00:00.000+03:00`;
  const endPlus3   = `${tmrwPlus3}T00:00:00.000+03:00`;

  async function getAccountStats(startTime, endTime) {
    const url = `${BASE}/adaccounts/${accountId}/stats?granularity=TOTAL&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await res.json();
    const s    = data?.total_stats?.[0]?.total_stat?.stats || {};
    return { spend_usd: Number(s.spend||0)/1e6, impressions: s.impressions, purchases: s.conversion_purchases, revenue_usd: Number(s.conversion_purchases_value||0)/1e6, startTime, endTime };
  }

  const [methodA, methodB] = await Promise.all([
    getAccountStats(startUTC, endUTC),
    getAccountStats(startPlus3, endPlus3),
  ]);

  return NextResponse.json({
    preset, daysBack,
    method_A_pure_UTC:    methodA,
    method_B_UTC_plus3:   methodB,
    current_utc:          new Date().toISOString(),
    current_plus3:        `${todayPlus3}T${String(new Date().getUTCHours() + 3).padStart(2,"0")}:${String(new Date().getUTCMinutes()).padStart(2,"0")} (local)`,
  });
}
