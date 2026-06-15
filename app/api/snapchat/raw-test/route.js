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

  // UTC+3 aware date range
  const OFFSET_MS = 3 * 60 * 60 * 1000;
  const nowLocal  = new Date(Date.now() + OFFSET_MS);

  function toLocalStr(d) {
    return new Date(d.getTime() + OFFSET_MS).toISOString().split("T")[0];
  }
  function toSnapTime(dateStr, hour = 0) {
    return `${dateStr}T${String(hour).padStart(2,"0")}:00:00.000+03:00`;
  }
  function daysAgo(n) {
    return toLocalStr(new Date(nowLocal.getTime() - n * 86400000));
  }

  const todayStr    = toLocalStr(nowLocal);
  const tomorrowStr = daysAgo(-1);
  const startMap    = {
    today: todayStr, yesterday: daysAgo(1),
    last_7d: daysAgo(6), last_30d: daysAgo(29), maximum: daysAgo(1095),
  };

  const startTime = toSnapTime(startMap[preset] || startMap.last_30d);
  const endTime   = toSnapTime(tomorrowStr);

  // Account summary
  const accRes  = await fetch(
    `${BASE}/adaccounts/${accountId}/stats?granularity=TOTAL` +
    `&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  const accData  = await accRes.json();
  const accStats = accData?.total_stats?.[0]?.total_stat?.stats || {};

  // Campaign samples
  const listRes  = await fetch(`${BASE}/adaccounts/${accountId}/campaigns?limit=20`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  const listData = await listRes.json();
  const camps    = (listData.campaigns || []).slice(0, 5);

  const campStats = [];
  for (const c of camps) {
    const id   = c.campaign?.id;
    const name = c.campaign?.name;
    const status = c.campaign?.status;
    const sr   = await fetch(
      `${BASE}/campaigns/${id}/stats?granularity=TOTAL` +
      `&fields=impressions,spend,swipes,conversion_purchases,conversion_purchases_value` +
      `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    const sd = await sr.json();
    const s  = sd?.total_stats?.[0]?.total_stat?.stats || {};
    campStats.push({
      id, name, status,
      spend_usd:   Number(s.spend||0)/1e6,
      impressions: s.impressions,
      purchases:   s.conversion_purchases,
      revenue_usd: Number(s.conversion_purchases_value||0)/1e6,
    });
  }

  return NextResponse.json({
    preset, startTime, endTime,
    account_summary: {
      spend_usd:   Number(accStats.spend||0)/1e6,
      impressions: accStats.impressions,
      purchases:   accStats.conversion_purchases,
      revenue_usd: Number(accStats.conversion_purchases_value||0)/1e6,
    },
    campaign_samples: campStats,
  });
}
