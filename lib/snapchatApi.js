// lib/snapchatApi.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared Snapchat Ads API helpers — date range building, stat fetching, and
// metric normalization. Used by both app/api/snapchat/insights (live,
// uncached read) and app/api/snapchat/sync (live read + persists to
// platform_daily_metrics). Keeping this in one place avoids the two routes
// drifting apart, which is what happened before: app/api/snapchat/sync had
// been overwritten with a copy of app/api/snapchat/data (a DB-cache-only
// read route) and never called the Snapchat API or wrote anything, so
// platform_daily_metrics stayed empty for every workspace no matter how
// often "sync" was clicked.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "https://adsapi.snapchat.com/v1";

// Verified fields — video_views does NOT exist in Snapchat API
export const FIELDS = [
  "impressions","swipes","spend",
  "conversion_purchases","conversion_purchases_value",
  "conversion_add_cart","conversion_add_billing","conversion_view_content",
  "quartile_1","quartile_2","quartile_3","view_completion","screen_time_millis",
].join(",");

const sleep   = ms => new Promise(r => setTimeout(r, ms));
const safeNum = v  => { const n=Number(v||0); return Number.isFinite(n)?n:0; };
const div     = (a,b) => { const x=safeNum(a),y=safeNum(b); return y?x/y:0; };
const micros  = v  => safeNum(v)/1_000_000;
const fix2    = v  => Number(safeNum(v).toFixed(2));
const pad     = v  => String(v).padStart(2,"0");

export function getDateRange(preset) {
  const utcNow = new Date();
  const rNow   = new Date(utcNow.getTime()+3*3600_000);
  const today  = { y:rNow.getUTCFullYear(), m:rNow.getUTCMonth()+1, d:rNow.getUTCDate(), h:rNow.getUTCHours() };
  function shiftDay(n) {
    const dt = new Date(Date.UTC(today.y,today.m-1,today.d));
    dt.setUTCDate(dt.getUTCDate()+n);
    return { y:dt.getUTCFullYear(), m:dt.getUTCMonth()+1, d:dt.getUTCDate() };
  }
  function stamp(p,h) { return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(h)}:00:00.000+03:00`; }
  const nowH = today.h || 1;
  let startDay, endDay, endHour;
  if      (preset==="today")      { startDay=today;           endDay=today; endHour=nowH; }
  else if (preset==="yesterday")  { startDay=shiftDay(-1);    endDay=today; endHour=0;    }
  else if (preset==="last_7d")    { startDay=shiftDay(-6);    endDay=today; endHour=nowH; }
  else if (preset==="last_30d")   { startDay=shiftDay(-29);   endDay=today; endHour=nowH; }
  else if (preset==="this_month") { startDay={...today,d:1};  endDay=today; endHour=nowH; }
  else if (preset==="last_90d")   { startDay=shiftDay(-89);   endDay=today; endHour=nowH; }
  else if (preset==="maximum")    { startDay=shiftDay(-1095); endDay=today; endHour=nowH; }
  else                            { startDay=shiftDay(-29);   endDay=today; endHour=nowH; }
  return { startTime:stamp(startDay,0), endTime:stamp(endDay,endHour) };
}

export async function snapFetch(url, token, retries=3) {
  for (let i=0; i<=retries; i++) {
    const res  = await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
    const text = await res.text();
    if (res.status===429 && i<retries) { await sleep(1500*(i+1)); continue; }
    try   { return {ok:res.ok,status:res.status,data:JSON.parse(text)}; }
    catch { return {ok:res.ok,status:res.status,data:null,raw:text.slice(0,400)}; }
  }
  return {ok:false,status:429,data:null};
}

export function buildMetrics(s={}) {
  const spend=micros(s.spend), rev=micros(s.conversion_purchases_value);
  const pur=safeNum(s.conversion_purchases), atc=safeNum(s.conversion_add_cart);
  const ic=safeNum(s.conversion_add_billing), vc=safeNum(s.conversion_view_content);
  const imp=safeNum(s.impressions), sw=safeNum(s.swipes);
  const q1=safeNum(s.quartile_1), q2=safeNum(s.quartile_2);
  const q3=safeNum(s.quartile_3), vcomp=safeNum(s.view_completion);
  const stms=safeNum(s.screen_time_millis);
  return {
    spend:fix2(spend), revenue:fix2(rev), purchase_value:fix2(rev),
    purchases:pur, add_to_cart:atc, initiate_checkout:ic, view_content:vc,
    impressions:imp, swipes:sw, clicks:sw,
    quartile_1:q1, quartile_2:q2, quartile_3:q3,
    view_completion:vcomp, screen_time_sec:fix2(stms/1000),
    roas:fix2(div(rev,spend)), cpa:fix2(div(spend,pur)), cost_per_atc:fix2(div(spend,atc)),
    ctr:fix2(div(sw,imp)*100), cpc:fix2(div(spend,sw)), cpm:fix2(div(spend,imp)*1000),
    hook_rate:fix2(div(q1,imp)*100), hold_rate:fix2(div(q3,q1)*100),
    completion_rate:fix2(div(vcomp,imp)*100),
  };
}

// Account-level summary.
//
// Snapchat's AdAccount stats endpoint rejects the full field list when
// called without a `breakdown` dimension ("Unsupported Stats Query: Only
// field 'spend' should be used when querying AdAccount stats", error code
// E1008) — so instead of calling that restricted endpoint, this sums the
// raw per-campaign stats from fetchBreakdown (which does accept the full
// field list) into a single account-level total. Metrics that are ratios
// (ctr, roas, cpm, ...) are recomputed from the summed raw numbers rather
// than averaged, since averaging per-campaign ratios would be wrong.
//
// Returns { ok: true, metrics } on success, or { ok: false, status, error }
// on failure — callers that only care about the metrics can use
// fetchAccountSummaryMetrics() below instead.
export async function fetchAccountSummary({accountId,token,startTime,endTime,swipeWindow,viewWindow}) {
  const breakdown = await fetchBreakdown({
    accountId, level: "campaign", token, startTime, endTime, swipeWindow, viewWindow
  });

  if (!breakdown.ok) {
    return { ok: false, status: null, error: breakdown.error };
  }

  const summedStats = Object.values(breakdown.statsById).reduce((acc, stats) => {
    for (const key of Object.keys(stats || {})) {
      acc[key] = (Number(acc[key]) || 0) + (Number(stats[key]) || 0);
    }
    return acc;
  }, {});

  return { ok: true, metrics: buildMetrics(summedStats) };
}

// Convenience wrapper for callers that only want the metrics (or null on
// failure) and don't need the error detail — preserves the old behavior.
export async function fetchAccountSummaryMetrics(args) {
  const result = await fetchAccountSummary(args);
  return result.ok ? result.metrics : null;
}

// Bulk breakdown — 1 call for all entities
// Confirmed structure: total_stats[0].breakdown_stats[level] = [{id, stats}]
export async function fetchBreakdown({accountId,level,token,startTime,endTime,swipeWindow,viewWindow}) {
  const url =
    `${BASE}/adaccounts/${accountId}/stats` +
    `?granularity=TOTAL&breakdown=${level}` +
    `&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}` +
    `&limit=1000`;

  const statsById={};
  let nextUrl=url, pages=0;

  while (nextUrl && pages<10) {
    const r = await snapFetch(nextUrl, token);
    if (!r.ok) {
      if (pages===0) return {ok:false, statsById:{}, error:r.data||r.raw};
      break;
    }
    const items = r.data?.total_stats?.[0]?.breakdown_stats?.[level] || [];
    for (const item of items) {
      if (item?.id) statsById[item.id] = item.stats || {};
    }
    nextUrl = r.data?.total_stats?.[0]?.paging?.next_link || r.data?.paging?.next_link || null;
    pages++;
  }

  return {ok:true, statsById, pages_fetched:pages, count:Object.keys(statsById).length};
}

export function normStatus(raw) {
  const s=String(raw?.status||raw?.effective_status||"").toUpperCase();
  if (["ACTIVE","RUNNING","DELIVERING","LIVE"].includes(s)) return "ACTIVE";
  if (["PAUSED","INACTIVE"].includes(s)) return "PAUSED";
  if (["PENDING","UNDER_REVIEW","IN_REVIEW"].includes(s)) return "PENDING";
  if (["DELETED","ARCHIVED"].includes(s)) return s;
  return s||"UNKNOWN";
}

export async function fetchEntities({accountId,level,token}) {
  const pathMap={campaign:"campaigns",adsquad:"adsquads",ad:"ads"};
  const path=pathMap[level]||"campaigns";
  let allRaw=[],nextUrl=`${BASE}/adaccounts/${accountId}/${path}?limit=1000`,pages=0;
  while (nextUrl && pages<15) {
    const r=await snapFetch(nextUrl,token);
    if (!r.ok) {
      if (pages===0) return {ok:false,error:r.data||r.raw,entities:[]};
      break;
    }
    allRaw=allRaw.concat(r.data?.[path]||[]);
    nextUrl=r.data?.paging?.next_link||null;
    pages++;
  }
  let entities=[];
  if (level==="campaign") {
    entities=allRaw.map(i=>{const c=i.campaign||i; return {id:c.id,name:c.name||"Unnamed",status:normStatus(c)};});
  } else if (level==="adsquad") {
    entities=allRaw.map(i=>{const a=i.adsquad||i; return {id:a.id,name:a.name||"Unnamed",campaign_id:a.campaign_id||"",status:normStatus(a)};});
  } else if (level==="ad") {
    entities=allRaw.map(i=>{const a=i.ad||i; return {id:a.id,name:a.name||"Unnamed",adsquad_id:a.ad_squad_id||a.adsquad_id||"",status:normStatus(a)};});
  }
  return {ok:true,entities,pages_fetched:pages};
}

export const VALID_SWIPE=["1_DAY","7_DAY","28_DAY"];
export const VALID_VIEW =["1_HOUR","3_HOUR","6_HOUR","1_DAY","7_DAY","28_DAY"];
