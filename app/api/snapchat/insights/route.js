import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

// Verified Snapchat API fields (video_views does NOT exist — use quartiles instead)
const FIELDS = [
  "impressions","swipes","spend",
  "conversion_purchases","conversion_purchases_value",
  "conversion_add_cart","conversion_add_billing","conversion_view_content",
  "quartile_1","quartile_2","quartile_3","view_completion","screen_time_millis",
].join(",");

const memoryCache = new Map();
const CACHE_TTL   = 5 * 60 * 1000;

const sleep   = ms => new Promise(r => setTimeout(r, ms));
const safeNum = v  => { const n = Number(v||0); return Number.isFinite(n) ? n : 0; };
const div     = (a,b) => { const x=safeNum(a),y=safeNum(b); return y ? x/y : 0; };
const micros  = v  => safeNum(v) / 1_000_000;
const fix2    = v  => Number(safeNum(v).toFixed(2));
const pad     = v  => String(v).padStart(2,"0");

function cacheGet(key) {
  const c = memoryCache.get(key);
  if (!c) return null;
  if (Date.now()-c.ts > CACHE_TTL) { memoryCache.delete(key); return null; }
  return c.data;
}
function cacheSet(key,data) { memoryCache.set(key,{ts:Date.now(),data}); }

// ── Date helpers (Riyadh UTC+3) ───────────────────────────────────────────────
function getDateRange(preset) {
  const utcNow = new Date();
  const rNow   = new Date(utcNow.getTime() + 3*3600_000);
  const today  = { y:rNow.getUTCFullYear(), m:rNow.getUTCMonth()+1, d:rNow.getUTCDate(), h:rNow.getUTCHours() };

  function shiftDay(n) {
    const dt = new Date(Date.UTC(today.y, today.m-1, today.d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return { y:dt.getUTCFullYear(), m:dt.getUTCMonth()+1, d:dt.getUTCDate() };
  }
  function stamp(p, h) { return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(h)}:00:00.000+03:00`; }

  const nowH = today.h;
  let startDay, endDay, endHour;

  if      (preset==="today")      { startDay=today;           endDay=today; endHour=nowH; }
  else if (preset==="yesterday")  { startDay=shiftDay(-1);    endDay=today; endHour=0; }
  else if (preset==="last_7d")    { startDay=shiftDay(-6);    endDay=today; endHour=nowH; }
  else if (preset==="last_30d")   { startDay=shiftDay(-29);   endDay=today; endHour=nowH; }
  else if (preset==="this_month") { startDay={...today,d:1};  endDay=today; endHour=nowH; }
  else if (preset==="last_90d")   { startDay=shiftDay(-89);   endDay=today; endHour=nowH; }
  else if (preset==="maximum")    { startDay=shiftDay(-1095); endDay=today; endHour=nowH; }
  else                            { startDay=shiftDay(-29);   endDay=today; endHour=nowH; }

  // Guard: today at midnight = zero range, give at least 1 hour
  if (preset==="today" && endHour===0) endHour=1;

  return { startTime:stamp(startDay,0), endTime:stamp(endDay,endHour) };
}

// ── HTTP with retry on 429 ────────────────────────────────────────────────────
async function snapFetch(url, token, retries=3) {
  for (let i=0; i<=retries; i++) {
    const res  = await fetch(url, { headers:{ Authorization:`Bearer ${token}` }, cache:"no-store" });
    const text = await res.text();
    if (res.status===429 && i<retries) { await sleep(1200*(i+1)); continue; }
    try   { return { ok:res.ok, status:res.status, data:JSON.parse(text) }; }
    catch { return { ok:res.ok, status:res.status, data:null, raw:text.slice(0,600) }; }
  }
  return { ok:false, status:429, data:null };
}

// ── Build metrics from a stats object ─────────────────────────────────────────
function buildMetrics(s) {
  const spend = micros(s.spend);
  const rev   = micros(s.conversion_purchases_value);
  const pur   = safeNum(s.conversion_purchases);
  const atc   = safeNum(s.conversion_add_cart);
  const ic    = safeNum(s.conversion_add_billing);
  const vc    = safeNum(s.conversion_view_content);
  const imp   = safeNum(s.impressions);
  const sw    = safeNum(s.swipes);
  const q1    = safeNum(s.quartile_1);
  const q2    = safeNum(s.quartile_2);
  const q3    = safeNum(s.quartile_3);
  const vcomp = safeNum(s.view_completion);
  const stms  = safeNum(s.screen_time_millis);
  return {
    spend:fix2(spend), revenue:fix2(rev), purchase_value:fix2(rev),
    purchases:pur, add_to_cart:atc, initiate_checkout:ic, view_content:vc,
    impressions:imp, swipes:sw, clicks:sw,
    quartile_1:q1, quartile_2:q2, quartile_3:q3,
    view_completion:vcomp, screen_time_sec:fix2(stms/1000),
    roas:fix2(div(rev,spend)), cpa:fix2(div(spend,pur)),
    cost_per_atc:fix2(div(spend,atc)),
    ctr:fix2(div(sw,imp)*100), cpc:fix2(div(spend,sw)), cpm:fix2(div(spend,imp)*1000),
    hook_rate:fix2(div(q1,imp)*100),
    hold_rate:fix2(div(q3,q1)*100),
    completion_rate:fix2(div(vcomp,imp)*100),
  };
}

// ── Account-level summary (1 call, no breakdown) ──────────────────────────────
async function fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}`;
  const r = await snapFetch(url, token);
  if (!r.ok) return null;
  // Account summary (no breakdown): total_stats[0].total_stat.stats
  const stats = r.data?.total_stats?.[0]?.total_stat?.stats || {};
  return buildMetrics(stats);
}

// ── Per-entity stats (fallback approach, proven to work) ──────────────────────
async function fetchOneEntityStats({ entityType, entityId, token, startTime, endTime, swipeWindow, viewWindow }) {
  const url =
    `${BASE}/${entityType}/${entityId}/stats` +
    `?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}`;
  const r = await snapFetch(url, token);
  if (!r.ok) return { ok:false, status:r.status, stats:{} };
  const arr   = r.data?.total_stats || [];
  const match = arr.find(i=>(i.total_stat||i)?.id===entityId) || arr[0] || null;
  const stats = match?.total_stat?.stats || match?.stats || {};
  return { ok:true, stats };
}

// ── Batch parallel per-entity (safe, proven) ──────────────────────────────────
async function fetchAllEntityStats({ entities, entityType, token, startTime, endTime, swipeWindow, viewWindow }) {
  const BATCH = 20;
  const DELAY = 200;
  const statsMap   = {};
  let rateLimited  = false;

  for (let i=0; i<entities.length; i+=BATCH) {
    if (rateLimited) break;
    const batch = entities.slice(i, i+BATCH);
    await Promise.all(batch.map(async e => {
      try {
        const r = await fetchOneEntityStats({ entityType, entityId:e.id, token, startTime, endTime, swipeWindow, viewWindow });
        statsMap[e.id] = r.stats || {};
        if (r.status===429) rateLimited = true;
      } catch { statsMap[e.id] = {}; }
    }));
    if (i+BATCH < entities.length && !rateLimited) await sleep(DELAY);
  }
  return { statsMap, rateLimited };
}

// ── Entity list with pagination ───────────────────────────────────────────────
function normStatus(raw) {
  const s = String(raw?.status||raw?.effective_status||"").toUpperCase();
  if (["ACTIVE","RUNNING","DELIVERING","LIVE"].includes(s)) return "ACTIVE";
  if (["PAUSED","INACTIVE"].includes(s)) return "PAUSED";
  if (["PENDING","UNDER_REVIEW","IN_REVIEW"].includes(s)) return "PENDING";
  return s || "UNKNOWN";
}

async function fetchEntities({ accountId, level, token }) {
  const pathMap = { campaign:"campaigns", adsquad:"adsquads", ad:"ads" };
  const path    = pathMap[level] || "campaigns";
  let allRaw=[], nextUrl=`${BASE}/adaccounts/${accountId}/${path}?limit=1000`, pages=0;

  while (nextUrl && pages<15) {
    const r = await snapFetch(nextUrl, token);
    if (!r.ok) {
      if (pages===0) return { ok:false, status:r.status, error:r.data||r.raw, entities:[] };
      break;
    }
    allRaw  = allRaw.concat(r.data?.[path] || []);
    nextUrl = r.data?.paging?.next_link || null;
    pages++;
  }

  let entities = [];
  if (level==="campaign") {
    entities = allRaw.map(i => { const c=i.campaign||i; return { id:c.id, name:c.name||"Unnamed", campaign_name:c.name||"Unnamed", status:normStatus(c) }; });
  } else if (level==="adsquad") {
    entities = allRaw.map(i => { const a=i.adsquad||i; return { id:a.id, name:a.name||"Unnamed", adsquad_name:a.name||"Unnamed", campaign_id:a.campaign_id||"", status:normStatus(a) }; });
  } else if (level==="ad") {
    entities = allRaw.map(i => { const a=i.ad||i; return { id:a.id, name:a.name||"Unnamed", ad_name:a.name||"Unnamed", adsquad_id:a.ad_squad_id||a.adsquad_id||"", status:normStatus(a) }; });
  }
  return { ok:true, entities, pages_fetched:pages };
}

// ── Summary from rows ─────────────────────────────────────────────────────────
function buildSummaryFromRows(rows) {
  const t = rows.reduce((a,r)=>({
    spend:a.spend+safeNum(r.spend), revenue:a.revenue+safeNum(r.revenue),
    purchases:a.purchases+safeNum(r.purchases), atc:a.atc+safeNum(r.add_to_cart),
    ic:a.ic+safeNum(r.initiate_checkout),
    imp:a.imp+safeNum(r.impressions), sw:a.sw+safeNum(r.swipes),
    q1:a.q1+safeNum(r.quartile_1), q3:a.q3+safeNum(r.quartile_3),
    vcomp:a.vcomp+safeNum(r.view_completion),
  }), {spend:0,revenue:0,purchases:0,atc:0,ic:0,imp:0,sw:0,q1:0,q3:0,vcomp:0});
  return {
    spend:fix2(t.spend), revenue:fix2(t.revenue), purchase_value:fix2(t.revenue),
    purchases:t.purchases, add_to_cart:t.atc, initiate_checkout:t.ic,
    impressions:t.imp, swipes:t.sw, clicks:t.sw,
    quartile_1:t.q1, quartile_3:t.q3, view_completion:t.vcomp,
    roas:fix2(div(t.revenue,t.spend)), cpa:fix2(div(t.spend,t.purchases)),
    cost_per_atc:fix2(div(t.spend,t.atc)),
    ctr:fix2(div(t.sw,t.imp)*100), cpc:fix2(div(t.spend,t.sw)), cpm:fix2(div(t.spend,t.imp)*1000),
    hook_rate:fix2(div(t.q1,t.imp)*100),
    hold_rate:fix2(div(t.q3,t.q1)*100),
    completion_rate:fix2(div(t.vcomp,t.imp)*100),
  };
}

const VALID_SWIPE = ["1_DAY","7_DAY","28_DAY"];
const VALID_VIEW  = ["1_HOUR","3_HOUR","6_HOUR","1_DAY","7_DAY","28_DAY"];

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const accountId  = searchParams.get("account_id");
  const level      = searchParams.get("level")        || "campaign";
  const datePreset = searchParams.get("date_preset")  || "last_30d";
  const force      = searchParams.get("force")        === "1";
  const snapToken  = searchParams.get("snap_token")   || null;

  const swRaw = searchParams.get("swipe_window") || "28_DAY";
  const vwRaw = searchParams.get("view_window")  || "1_DAY";
  const swipeWindow = VALID_SWIPE.includes(swRaw) ? swRaw : "28_DAY";
  const viewWindow  = VALID_VIEW.includes(vwRaw)  ? vwRaw : "1_DAY";

  if (!accountId) return NextResponse.json({ success:false, error:"account_id is required" });

  const cacheKey = `${accountId}:${level}:${datePreset}:${swipeWindow}:${viewWindow}`;
  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) return NextResponse.json({ ...cached, cached:true });
  }

  const token = snapToken || await getSnapchatToken();
  if (!token) return NextResponse.json({ success:false, error:"Not connected to Snapchat" });

  const { startTime, endTime } = getDateRange(datePreset);
  const entityType = { campaign:"campaigns", adsquad:"adsquads", ad:"ads" }[level] || "campaigns";

  const [accountSummary, entitiesResult] = await Promise.all([
    fetchAccountSummary({ accountId, token, startTime, endTime, swipeWindow, viewWindow }),
    fetchEntities({ accountId, level, token }),
  ]);

  if (!entitiesResult.ok) {
    return NextResponse.json({ success:false, error:entitiesResult.error });
  }

  const allEntities = entitiesResult.entities;
  const skipStatus  = ["DELETED","ARCHIVED"];
  const toLoad      = allEntities.filter(e => !skipStatus.includes(e.status));

  const { statsMap, rateLimited } = await fetchAllEntityStats({
    entities:toLoad, entityType, token, startTime, endTime, swipeWindow, viewWindow
  });

  const allRows = toLoad.map(e => ({ ...e, ...buildMetrics(statsMap[e.id]||{}) }));
  const rows    = allRows.filter(r => safeNum(r.spend) > 0.001)
                         .sort((a,b) => safeNum(b.spend)-safeNum(a.spend));

  const summary = accountSummary || buildSummaryFromRows(rows);

  const payload = {
    success:true, provider:"Snapchat Ads",
    account_id:accountId, level, date_preset:datePreset,
    start_time:startTime, end_time:endTime,
    attribution:{ swipe_window:swipeWindow, view_window:viewWindow },
    total_entities:allEntities.length,
    active_entities:allEntities.filter(e=>e.status==="ACTIVE").length,
    loaded_count:rows.length,
    rate_limited:rateLimited,
    summary, data:rows,
  };

  cacheSet(cacheKey, payload);
  return NextResponse.json(payload);
}
