import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

// Debug route: shows the RAW Snapchat API response for one campaign
// so you can manually verify spend/purchases/revenue against Snapchat Ads Manager UI.
// Usage: /api/snapchat/debug-raw?account_id=XXX&date_preset=last_7d

export async function GET(request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const accountId  = searchParams.get("account_id");
  const datePreset = searchParams.get("date_preset") || "last_7d";

  if (!accountId) return NextResponse.json({ error: "account_id required" });

  const token = await getSnapchatToken(request);
  if (!token) return NextResponse.json({ error: "Not connected" });

  // Riyadh date range (same logic as main route)
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

  // 1. Raw account-level stats (NO attribution window override — uses account default)
  const urlDefault = `${BASE}/adaccounts/${accountId}/stats?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;

  // 2. Same but with explicit 28d/1d attribution (matches Ads Manager default)
  const urlExplicit = `${urlDefault}&swipe_up_attribution_window=28_DAY&view_attribution_window=1_DAY`;

  // 3. Same but with 1d/1d (tighter — for comparison)
  const urlTight = `${urlDefault}&swipe_up_attribution_window=1_DAY&view_attribution_window=1_DAY`;

  const [r1, r2, r3] = await Promise.all([
    fetch(urlDefault,  { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).then(r=>r.json()).catch(e=>({error:e.message})),
    fetch(urlExplicit, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).then(r=>r.json()).catch(e=>({error:e.message})),
    fetch(urlTight,    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).then(r=>r.json()).catch(e=>({error:e.message})),
  ]);

  function summarize(raw) {
    const stats = raw?.total_stats?.[0]?.total_stat?.stats || {};
    return {
      raw_stats: stats,
      spend_usd: (Number(stats.spend||0)/1e6).toFixed(2),
      revenue_usd: (Number(stats.conversion_purchases_value||0)/1e6).toFixed(2),
      purchases: stats.conversion_purchases,
      add_cart: stats.conversion_add_cart,
      add_billing: stats.conversion_add_billing,
      view_content: stats.conversion_view_content,
      impressions: stats.impressions,
      swipes: stats.swipes,
      quartile_1: stats.quartile_1,
      quartile_2: stats.quartile_2,
      quartile_3: stats.quartile_3,
      view_completion: stats.view_completion,
    };
  }

  return NextResponse.json({
    note: "Compare these 3 results against your Snapchat Ads Manager UI for the SAME date range to find which attribution window matches. If 'default' and 'explicit_28_1' match Ads Manager — you're good. If numbers are way off, the issue may be date range or account selection, not field names.",
    account_id: accountId,
    date_preset: datePreset,
    start_time: startTime,
    end_time: endTime,
    results: {
      "1_default_no_attribution_param": summarize(r1),
      "2_explicit_28d_swipe_1d_view":   summarize(r2),
      "3_tight_1d_swipe_1d_view":       summarize(r3),
    },
    raw_responses: { r1, r2, r3 },
  });
}
