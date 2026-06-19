import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

// ── VERIFIED Snapchat API fields (confirmed against official docs) ───────────
// NOTE: "video_views" and "video_views_15s" are NOT real API fields.
// Real video metrics are: quartile_1/2/3, view_completion, screen_time_millis
const FIELDS = [
  "impressions",
  "swipes",
  "spend",
  "conversion_purchases",
  "conversion_purchases_value",
  "conversion_add_cart",
  "conversion_add_billing",      // checkout-initiated equivalent on Snapchat
  "conversion_view_content",
  "quartile_1",                  // Video Plays at 25%
  "quartile_2",                  // Video Plays at 50%
  "quartile_3",                  // Video Plays at 75%
  "view_completion",             // Video Completions (97%)
  "screen_time_millis",          // Total screen time
].join(",");

const memoryCache = new Map();
const CACHE_TTL   = 5 * 60 * 1000;
const BATCH_SIZE  = 25;
const BATCH_DELAY = 150;

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
  function shift(n) {
    const dt = new Date(Date.UTC(today.y,today.m-1,today.d));
    dt.setUTCDate(dt.getUTCDate()+n);
    return { y:dt.getUTCFullYear(), m:dt.getUTCMonth()+1, d:dt.getUTCDate() };
  }
  function stamp(p,h=0) { return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(h)}:00:00.000+03:00`; }
  const curH = Math.min(today.h+1,23);
  const map  = {
    today:     { s:today,       eH:curH },
    yesterday: { s:shift(-1),   eH:0    },
    last_7d:   { s:shift(-6),   eH:curH },
    last_30d:  { s:shift(-29),  eH:curH },
    this_month:{ s:{...today,d:1}, eH:curH },
    last_90d:  { s:shift(-89),  eH:curH },
    maximum:   { s:shift(-1095),eH:curH },
  };
  const p = map[preset]||map.last_30d;
  return { startTime:stamp(p.s,0), endTime:stamp(today,p.eH) };
}

// ── HTTP with retry ────────────────────────────────────────────────────────────
async function snapFetch(url,token,retries=2) {
  for (let i=0;i<=retries;i++) {
    const res  = await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
    const text = await res.text();
    if (res.status===429 && i<retries) { await sleep(1500*(i+1)); continue; }
    try   { return {ok:res.ok,status:res.status,data:JSON.parse(text)}; }
    catch { return {ok:res.ok,status:res.status,data:null,raw:text.slice(0,600)}; }
  }
  return {ok:false,status:429,data:null};
}

// ── Stats extraction — matches by id, falls back to first result ────────────
function extractStats(payload,id) {
  const arr   = payload?.total_stats||[];
  const match = arr.find(i=>{
    const s = i.total_stat||i;
    return s.id===id || s.campaign_id===id || s.ad_squad_id===id || s.ad_id===id;
  })||arr[0]||null;
  return match?.total_stat?.stats||match?.stats||{};
}

// ── Build metrics from raw API stats ──────────────────────────────────────────
function buildMetrics(s) {
  const spend = micros(s.spend);
  const rev   = micros(s.conversion_purchases_value);
  const pur   = safeNum(s.conversion_purchases);
  // Use conversion_add_cart as primary ATC signal (conversion_add_billing is checkout-stage)
  const atc   = safeNum(s.conversion_add_cart);
  const ic    = safeNum(s.conversion_add_billing); // "initiate checkout" equivalent
  const vc_content = safeNum(s.conversion_view_content);
  const imp   = safeNum(s.impressions);
  const sw    = safeNum(s.swipes);

  // Real video metrics
  const q1    = safeNum(s.quartile_1);   // 25% plays
  const q2    = safeNum(s.quartile_2);   // 50% plays
  const q3    = safeNum(s.quartile_3);   // 75% plays
  const vc    = safeNum(s.view_completion); // 97% completion
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
    // Video funnel — using REAL fields (quartile_1 ≈ "hook", view_completion ≈ "hold/finish")
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
    // hook_rate = % of impressions that played to 25% (best available proxy for "stopped scroll")
    hook_rate:        fix2(divide(q1, imp) * 100),
    // hold_rate = % of 25%-viewers who made it to 75%
    hold_rate:        fix2(divide(q3, q1) * 100),
    // completion_rate = % of impressions that finished (97%)
    completion_rate:  fix2(divide(vc, imp) * 100),
  };
}

// ── Account-level summary ─────────────────────────────────────────────────────
async function fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}`;
  const r = await snapFetch(url, token);
  if (!r.ok) return null;
  return buildMetrics(extractStats(r.data, accountId));
}

// ── Single entity stats ───────────────────────────────────────────────────────
async function fetchOneStats({ entityType, entityId, token, startTime, endTime, swipeWindow, viewWindow }) {
  const url =
    `${BASE}/${entityType}/${entityId}/stats` +
    `?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}`;
  const r = await snapFetch(url, token);
  if (!r.ok) return { status: r.status, stats: {} };
  return { status: r.status, stats: extractStats(r.data, entityId) };
}

// ── Parallel batch stats ──────────────────────────────────────────────────────
async function fetchStatsParallel({ entities, entityType, token, startTime, endTime, swipeWindow, viewWindow }) {
  const statsMap  = {};
  let rateLimited = false;
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    if (rateLimited) break;
    const batch = entities.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async e => {
      try {
        const r = await fetchOneStats({ entityType, entityId: e.id, token, startTime, endTime, swipeWindow, viewWindow });
        statsMap[e.id] = r.stats || {};
        if (r.status === 429) rateLimited = true;
      } catch { statsMap[e.id] = {}; }
    }));
    if (i + BATCH_SIZE < entities.length && !rateLimited) await sleep(BATCH_DELAY);
  }
  return { statsMap, rateLimited };
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

// ── Entity list WITH PAGINATION ───────────────────────────────────────────────
async function fetchEntities({ accountId, level, token }) {
  const pathMap = { campaign: "campaigns", adsquad: "adsquads", ad: "ads" };
  const path    = pathMap[level] || "campaigns";

  let allRaw  = [];
  let nextUrl = `${BASE}/adaccounts/${accountId}/${path}?limit=200`;
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

// ── Summary from rows ─────────────────────────────────────────────────────────
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

  // Attribution window — selectable from the page, defaults to Snapchat's own
  // Ads Manager default (28-day click / 1-day view) so numbers match the UI.
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
  const entityType = { campaign:"campaigns", adsquad:"adsquads", ad:"ads" }[level] || "campaigns";

  const [accountSummary, entitiesResult] = await Promise.all([
    fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }),
    fetchEntities({ accountId, level, token }),
  ]);

  if (!entitiesResult.ok) {
    return NextResponse.json({ success: false, error: entitiesResult.error });
  }

  const allEntities = entitiesResult.entities;
  const shortRange   = ["today","yesterday","last_7d"].includes(datePreset);
  const skipStatus   = ["DELETED","ARCHIVED"];
  const toLoad = shortRange
    ? allEntities.filter(e => e.status === "ACTIVE")
    : allEntities.filter(e => !skipStatus.includes(e.status));

  const { statsMap, rateLimited } = await fetchStatsParallel({
    entities: toLoad, entityType, token, startTime, endTime, swipeWindow, viewWindow,
  });

  const allRows = toLoad.map(e => ({ ...e, ...buildMetrics(statsMap[e.id] || {}) }));
  const rows = allRows.filter(r => safeNum(r.spend) > 0.001).sort((a,b) => safeNum(b.spend) - safeNum(a.spend));
  const summary = accountSummary || buildSummaryFromRows(rows);

  const payload = {
    success:        true,
    provider:       "Snapchat Ads",
    account_id:     accountId,
    level,
    date_preset:    datePreset,
    start_time:     startTime,
    end_time:       endTime,
    attribution:    { swipe_window: swipeWindow, view_window: viewWindow },
    total_entities: allEntities.length,
    active_entities:allEntities.filter(e => e.status === "ACTIVE").length,
    loaded_count:   rows.length,
    pages_fetched:  entitiesResult.pages_fetched,
    rate_limited:   rateLimited,
    summary,
    data: rows,
  };

  cacheSet(cacheKey, payload);
  return NextResponse.json(payload);
}
