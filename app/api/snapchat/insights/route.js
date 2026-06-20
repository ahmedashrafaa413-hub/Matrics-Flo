import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

// Verified Snapchat API fields
const FIELDS = [
  "impressions",
  "swipes",
  "spend",
  "conversion_purchases",
  "conversion_purchases_value",
  "conversion_add_cart",
  "conversion_add_billing",
  "conversion_view_content",
  "quartile_1",
  "quartile_2",
  "quartile_3",
  "view_completion",
  "screen_time_millis",
].join(",");

const memoryCache = new Map();
const CACHE_TTL   = 5 * 60 * 1000;

const sleep   = ms  => new Promise(r => setTimeout(r, ms));
const safeNum = v   => { const n=Number(v||0); return Number.isFinite(n)?n:0; };
const divide  = (a,b)=> { const x=safeNum(a),y=safeNum(b); return y?x/y:0; };
const micros  = v   => safeNum(v)/1_000_000;
const fix2    = v   => Number(safeNum(v).toFixed(2));
const pad     = v   => String(v).padStart(2,"0");

function cacheGet(key) {
  const c = memoryCache.get(key);
  if (!c) return null;
  if (Date.now()-c.ts > CACHE_TTL) { memoryCache.delete(key); return null; }
  return c.data;
}
function cacheSet(key,data) { memoryCache.set(key,{ts:Date.now(),data}); }

// ── Date — Riyadh UTC+3 ───────────────────────────────────────────────────────
function getDateRange(preset) {
  const utcNow = new Date();
  const rNow   = new Date(utcNow.getTime()+3*3600_000);
  const today  = { y:rNow.getUTCFullYear(), m:rNow.getUTCMonth()+1, d:rNow.getUTCDate(), h:rNow.getUTCHours() };

  function shiftDay(p, n) {
    const dt = new Date(Date.UTC(p.y,p.m-1,p.d));
    dt.setUTCDate(dt.getUTCDate()+n);
    return { y:dt.getUTCFullYear(), m:dt.getUTCMonth()+1, d:dt.getUTCDate() };
  }
  function stamp(p,h) { return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(h)}:00:00.000+03:00`; }

  // IMPORTANT: end_time must never be in the future. Using `today.h` (the
  // CURRENT hour, not h+1) means we only request hours that have actually
  // started — never a future hour Snapchat hasn't recorded data for yet.
  // The previous version used today.h+1 which pushed end_time one hour into
  // the future and caused "today" numbers to look wrong/incomplete.
  const nowHour = today.h;

  let startDay, endDay, endHour;

  if (preset === "today") {
    startDay = today;       endDay = today;            endHour = nowHour;
  } else if (preset === "yesterday") {
    const yest = shiftDay(today, -1);
    startDay = yest;        endDay = today;             endHour = 0; // up to midnight = all of yesterday
  } else if (preset === "last_7d") {
    startDay = shiftDay(today, -6);  endDay = today;     endHour = nowHour;
  } else if (preset === "last_30d") {
    startDay = shiftDay(today, -29); endDay = today;     endHour = nowHour;
  } else if (preset === "this_month") {
    startDay = { ...today, d: 1 };   endDay = today;     endHour = nowHour;
  } else if (preset === "last_90d") {
    startDay = shiftDay(today, -89); endDay = today;     endHour = nowHour;
  } else if (preset === "maximum") {
    startDay = shiftDay(today, -1095); endDay = today;   endHour = nowHour;
  } else {
    // default: last_30d
    startDay = shiftDay(today, -29); endDay = today;     endHour = nowHour;
  }
  // Guard: at exactly midnight (hour 0), today's start/end would be identical
  // (00:00 to 00:00 = zero range). Ensure at least 1 hour of data is requested.
  if (preset === "today" && endHour === 0 && startDay.y===endDay.y && startDay.m===endDay.m && startDay.d===endDay.d) {
    endHour = 1;
  }

  return { startTime:stamp(startDay,0), endTime:stamp(endDay,endHour) };
}

// ── HTTP with retry ────────────────────────────────────────────────────────────
async function snapFetch(url,token,retries=3) {
  for (let i=0;i<=retries;i++) {
    const res  = await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
    const text = await res.text();
    if (res.status===429 && i<retries) { await sleep(1200*(i+1)); continue; }
    try   { return {ok:res.ok,status:res.status,data:JSON.parse(text)}; }
    catch { return {ok:res.ok,status:res.status,data:null,raw:text.slice(0,600)}; }
  }
  return {ok:false,status:429,data:null};
}

// ── Build metrics from raw stats object ───────────────────────────────────────
function buildMetrics(s) {
  const spend = micros(s.spend);
  const rev   = micros(s.conversion_purchases_value);
  const pur   = safeNum(s.conversion_purchases);
  const atc   = safeNum(s.conversion_add_cart);
  const ic    = safeNum(s.conversion_add_billing);
  const vc_content = safeNum(s.conversion_view_content);
  const imp   = safeNum(s.impressions);
  const sw    = safeNum(s.swipes);
  const q1    = safeNum(s.quartile_1);
  const q2    = safeNum(s.quartile_2);
  const q3    = safeNum(s.quartile_3);
  const vc    = safeNum(s.view_completion);
  const screenTimeMs = safeNum(s.screen_time_millis);

  return {
    spend:            fix2(spend),
    revenue:          fix2(rev),
    purchase_value:   fix2(rev),
    purchases:        pur,
    add_to_cart:      atc,
    initiate_checkout:ic,
    view_content:     vc_content,
    impressions:      imp,
    swipes:           sw,
    clicks:           sw,
    quartile_1:       q1,
    quartile_2:       q2,
    quartile_3:       q3,
    view_completion:  vc,
    screen_time_sec:  fix2(screenTimeMs/1000),
    roas:             fix2(divide(rev, spend)),
    cpa:              fix2(divide(spend, pur)),
    cost_per_atc:     fix2(divide(spend, atc)),
    ctr:              fix2(divide(sw, imp) * 100),
    cpc:              fix2(divide(spend, sw)),
    cpm:              fix2(divide(spend, imp) * 1000),
    hook_rate:        fix2(divide(q1, imp) * 100),
    hold_rate:        fix2(divide(q3, q1) * 100),
    completion_rate:  fix2(divide(vc, imp) * 100),
  };
}

// ── Account-level TOTAL summary (single call) ─────────────────────────────────
async function fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}`;
  const r = await snapFetch(url, token);
  if (!r.ok) return null;
  const stats = r.data?.total_stats?.[0]?.total_stat?.stats || {};
  return buildMetrics(stats);
}

// ── BULK breakdown call — gets ALL entities of a level in ONE request ────────
// This replaces N individual /campaigns/{id}/stats calls with a single
// /adaccounts/{id}/stats?breakdown=X call. Massively faster and avoids
// partial-failure discrepancies that happen when individual calls 429/timeout.
async function fetchBreakdownStats({ accountId, level, token, startTime, endTime, swipeWindow, viewWindow }) {
  const breakdownMap = { campaign: "campaign", adsquad: "adsquad", ad: "ad" };
  const breakdown = breakdownMap[level] || "campaign";

  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL&breakdown=${breakdown}` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}` +
    `&limit=1000`;

  let allBreakdownStats = [];
  let nextUrl = url;
  let pages = 0;

  while (nextUrl && pages < 10) {
    const r = await snapFetch(nextUrl, token);
    if (!r.ok) {
      if (pages === 0) return { ok: false, status: r.status, error: r.data || r.raw, statsById: {} };
      break;
    }
    // breakdown_stats is the array shape when ?breakdown= is used
    const stats = r.data?.total_stats?.[0]?.total_stat?.breakdown_stats?.[breakdown] || [];
    allBreakdownStats = allBreakdownStats.concat(stats);
    nextUrl = r.data?.paging?.next_link || null;
    pages++;
  }

  // Map by entity id for easy lookup
  const statsById = {};
  for (const item of allBreakdownStats) {
    const id = item.id;
    if (id) statsById[id] = item.stats || {};
  }

  return { ok: true, statsById, pages_fetched: pages };
}

// ── Status normalizer ─────────────────────────────────────────────────────────
function normStatus(raw) {
  const s = String(raw?.status || raw?.effective_status || raw?.delivery_status || "").toUpperCase();
  if (["ACTIVE","RUNNING","DELIVERING","LIVE"].includes(s)) return "ACTIVE";
  if (["PAUSED","INACTIVE","AD_PAUSED","CAMPAIGN_PAUSED","ADSQUAD_PAUSED"].includes(s)) return "PAUSED";
  if (["PENDING","UNDER_REVIEW","IN_REVIEW","REVIEW"].includes(s)) return "PENDING";
  if (["DELETED","ARCHIVED"].includes(s)) return s;
  return s || "ACTIVE";
}

// ── Entity list WITH PAGINATION (for names/status only — stats come from breakdown) ──
async function fetchEntities({ accountId, level, token }) {
  const pathMap = { campaign: "campaigns", adsquad: "adsquads", ad: "ads" };
  const path    = pathMap[level] || "campaigns";

  let allRaw  = [];
  let nextUrl = `${BASE}/adaccounts/${accountId}/${path}?limit=1000`;
  let pages   = 0;

  while (nextUrl && pages < 15) {
    const r = await snapFetch(nextUrl, token);
    if (!r.ok) {
      if (pages === 0) return { ok: false, status: r.status, error: r.data || r.raw, entities: [] };
      break;
    }
    allRaw  = allRaw.concat(r.data?.[path] || []);
    nextUrl = r.data?.paging?.next_link || null;
    pages++;
  }

  let entities = [];
  if (level === "campaign") {
    entities = allRaw.map(i => { const c=i.campaign||i; return { id:c.id, name:c.name||"Unnamed", campaign_name:c.name||"Unnamed", status:normStatus(c) }; });
  } else if (level === "adsquad") {
    entities = allRaw.map(i => { const a=i.adsquad||i; return { id:a.id, name:a.name||"Unnamed", adsquad_name:a.name||"Unnamed", campaign_id:a.campaign_id||"", status:normStatus(a) }; });
  } else if (level === "ad") {
    entities = allRaw.map(i => { const a=i.ad||i; return { id:a.id, name:a.name||"Unnamed", ad_name:a.name||"Unnamed", adsquad_id:a.ad_squad_id||a.adsquad_id||"", status:normStatus({status:a.status||a.effective_status||"ACTIVE"}) }; });
  }

  return { ok: true, entities, pages_fetched: pages };
}

// ── Summary from rows (fallback) ──────────────────────────────────────────────
function buildSummaryFromRows(rows) {
  const t = rows.reduce((a,r) => ({
    spend:a.spend+safeNum(r.spend), revenue:a.revenue+safeNum(r.revenue),
    purchases:a.purchases+safeNum(r.purchases), atc:a.atc+safeNum(r.add_to_cart),
    ic:a.ic+safeNum(r.initiate_checkout),
    imp:a.imp+safeNum(r.impressions), sw:a.sw+safeNum(r.swipes),
    q1:a.q1+safeNum(r.quartile_1), q3:a.q3+safeNum(r.quartile_3), vc:a.vc+safeNum(r.view_completion),
  }), { spend:0,revenue:0,purchases:0,atc:0,ic:0,imp:0,sw:0,q1:0,q3:0,vc:0 });

  return {
    spend:fix2(t.spend), revenue:fix2(t.revenue), purchase_value:fix2(t.revenue),
    purchases:t.purchases, add_to_cart:t.atc, initiate_checkout:t.ic,
    impressions:t.imp, swipes:t.sw, clicks:t.sw,
    quartile_1:t.q1, quartile_3:t.q3, view_completion:t.vc,
    roas:fix2(divide(t.revenue,t.spend)), cpa:fix2(divide(t.spend,t.purchases)),
    cost_per_atc:fix2(divide(t.spend,t.atc)),
    ctr:fix2(divide(t.sw,t.imp)*100), cpc:fix2(divide(t.spend,t.sw)), cpm:fix2(divide(t.spend,t.imp)*1000),
    hook_rate:fix2(divide(t.q1,t.imp)*100),
    hold_rate:fix2(divide(t.q3,t.q1)*100),
    completion_rate:fix2(divide(t.vc,t.imp)*100),
  };
}

const VALID_SWIPE_WINDOWS = ["1_DAY","7_DAY","28_DAY"];
const VALID_VIEW_WINDOWS  = ["1_HOUR","3_HOUR","6_HOUR","1_DAY","7_DAY","28_DAY"];

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId  = searchParams.get("account_id");
  const level      = searchParams.get("level")       || "campaign";
  const datePreset = searchParams.get("date_preset") || "last_30d";
  const force      = searchParams.get("force")       === "1";
  const snapToken  = searchParams.get("snap_token")  || null;

  const swipeWindowRaw = searchParams.get("swipe_window") || "28_DAY";
  const viewWindowRaw  = searchParams.get("view_window")  || "1_DAY";
  const swipeWindow = VALID_SWIPE_WINDOWS.includes(swipeWindowRaw) ? swipeWindowRaw : "28_DAY";
  const viewWindow  = VALID_VIEW_WINDOWS.includes(viewWindowRaw)   ? viewWindowRaw  : "1_DAY";

  if (!accountId) return NextResponse.json({ success: false, error: "account_id is required" });

  const cacheKey = `${accountId}:${level}:${datePreset}:${swipeWindow}:${viewWindow}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  const token = snapToken || await getSnapchatToken();
  if (!token) return NextResponse.json({ success: false, error: "Not connected to Snapchat" });

  const { startTime, endTime } = getDateRange(datePreset);

  // 3 calls total, in parallel: account summary, entity names/status, breakdown stats
  const [accountSummary, entitiesResult, breakdownResult] = await Promise.all([
    fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }),
    fetchEntities({ accountId, level, token }),
    fetchBreakdownStats({ accountId, level, token, startTime, endTime, swipeWindow, viewWindow }),
  ]);

  if (!entitiesResult.ok) {
    return NextResponse.json({ success: false, error: entitiesResult.error });
  }

  const allEntities = entitiesResult.entities;

  let rows = [];
  let usedFallback = false;

  if (breakdownResult.ok && Object.keys(breakdownResult.statsById).length > 0) {
    // Fast path: merge entity metadata (name/status) with bulk breakdown stats
    rows = allEntities
      .map(e => ({ ...e, ...buildMetrics(breakdownResult.statsById[e.id] || {}) }))
      .filter(r => safeNum(r.spend) > 0.001)
      .sort((a,b) => safeNum(b.spend) - safeNum(a.spend));
  } else {
    // Breakdown endpoint failed or empty — this should rarely happen.
    // We do NOT silently fall back to slow per-entity calls (that caused
    // both the slowness and the data mismatches before). Instead we
    // report it clearly so it's visible if Snapchat's breakdown API changes.
    usedFallback = true;
    rows = [];
  }

  const summary = accountSummary || buildSummaryFromRows(rows);

  const payload = {
    success:         true,
    provider:        "Snapchat Ads",
    account_id:      accountId,
    level,
    date_preset:     datePreset,
    start_time:      startTime,
    end_time:        endTime,
    attribution:     { swipe_window: swipeWindow, view_window: viewWindow },
    total_entities:  allEntities.length,
    active_entities: allEntities.filter(e => e.status === "ACTIVE").length,
    loaded_count:    rows.length,
    breakdown_used:  breakdownResult.ok,
    breakdown_error: breakdownResult.ok ? null : breakdownResult.error,
    used_fallback:   usedFallback,
    summary,
    data: rows,
  };

  cacheSet(cacheKey, payload);
  return NextResponse.json(payload);
}
