import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

// Debug route: shows the RAW response shape from the bulk breakdown endpoint
// so we can confirm the exact JSON structure Snapchat returns for ?breakdown=campaign|adsquad|ad
// Usage: /api/snapchat/debug-breakdown?account_id=XXX&level=campaign&date_preset=last_7d

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId  = searchParams.get("account_id");
  const level      = searchParams.get("level") || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_7d";

  if (!accountId) return NextResponse.json({ error: "account_id required" });

  const token = await getSnapchatToken(request);
  if (!token) return NextResponse.json({ error: "Not connected" });

  const utcNow = new Date();
  const rNow   = new Date(utcNow.getTime() + 3*3600_000);
  const today  = { y: rNow.getUTCFullYear(), m: rNow.getUTCMonth()+1, d: rNow.getUTCDate(), h: rNow.getUTCHours() };
  function shift(n) {
    const dt = new Date(Date.UTC(today.y, today.m-1, today.d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth()+1, d: dt.getUTCDate() };
  }
  function stamp(p, h=0) { return `${p.y}-${String(p.m).padStart(2,"0")}-${String(p.d).padStart(2,"0")}T${String(h).padStart(2,"0")}:00:00.000+03:00`; }
  const map = {
    today:     { s: today,        eH: Math.min(today.h+1,23) },
    yesterday: { s: shift(-1),    eH: 0 },
    last_7d:   { s: shift(-6),    eH: today.h },
    last_30d:  { s: shift(-29),   eH: today.h },
  };
  const p = map[datePreset] || map.last_7d;
  const startTime = stamp(p.s, 0);
  const endTime   = stamp(today, p.eH);

  const FIELDS = [
    "impressions","swipes","spend",
    "conversion_purchases","conversion_purchases_value",
    "conversion_add_cart","conversion_add_billing","conversion_view_content",
    "quartile_1","quartile_2","quartile_3","view_completion","screen_time_millis",
  ].join(",");

  const breakdownMap = { campaign: "campaign", adsquad: "adsquad", ad: "ad" };
  const breakdown = breakdownMap[level] || "campaign";

  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL&breakdown=${breakdown}` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=28_DAY&view_attribution_window=1_DAY` +
    `&limit=50`;

  const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { parse_error: true, raw: text.slice(0, 2000) }; }

  // Also try the non-breakdown single-entity call for comparison (first entity only)
  const listUrl = `${BASE}/adaccounts/${accountId}/campaigns?limit=1`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const listData = await listRes.json().catch(() => null);
  const firstCampaignId = listData?.campaigns?.[0]?.campaign?.id;

  let singleEntityComparison = null;
  if (firstCampaignId) {
    const singleUrl =
      `${BASE}/campaigns/${firstCampaignId}/stats` +
      `?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}` +
      `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
      `&swipe_up_attribution_window=28_DAY&view_attribution_window=1_DAY`;
    const singleRes = await fetch(singleUrl, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    singleEntityComparison = await singleRes.json().catch(() => null);
  }

  return NextResponse.json({
    note: "Check raw_breakdown_response below to see the EXACT shape Snapchat returns for the breakdown param. Look for where the per-entity stats array lives (could be under total_stats[0].total_stat.breakdown_stats[X], or a different key entirely). Compare against single_entity_comparison for the same campaign to verify numbers match.",
    request_url: url,
    breakdown_used: breakdown,
    date_range: { startTime, endTime },
    raw_breakdown_response: data,
    single_entity_comparison: {
      campaign_id: firstCampaignId,
      response: singleEntityComparison,
    },
  });
}
