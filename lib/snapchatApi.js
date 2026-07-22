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

export async function snapFetch(url, token, retries=2) {
  for (let i=0; i<=retries; i++) {
    let res;
    try {
      res = await fetch(url,{
        headers:{Authorization:`Bearer ${token}`},
        cache:"no-store",
        signal: AbortSignal.timeout(20_000)
      });
    } catch (error) {
      if (i < retries) continue;
      return {ok:false,status:504,data:null,raw:error?.message||"Snapchat request timed out"};
    }
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

// Per-entity stats (one call per campaign/adsquad/ad). This is the ONLY
// reliable way to get real numbers: the bulk "breakdown" endpoint
// (?breakdown=campaign, one call for every entity) silently returns
// empty/zero stats for accounts with a large number of campaigns — it
// stayed unnoticed because nothing compared it against ground truth until
// app/api/snapchat/debug-compare (which already used this per-entity
// approach) showed a real account with $739k of spend having stats:{}
// from the bulk endpoint. Slower (one request per entity) but correct.
export async function fetchEntityStats({level,entityId,token,startTime,endTime,swipeWindow,viewWindow}) {
  const pathMap={campaign:"campaigns",adsquad:"adsquads",ad:"ads"};
  const path=pathMap[level]||"campaigns";
  const url =
    `${BASE}/${path}/${encodeURIComponent(entityId)}/stats` +
    `?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}`;

  const r = await snapFetch(url, token);
  if (!r.ok) {
    return { ok: false, status: r.status, error: r.data || r.raw || null };
  }
  const stats = r.data?.total_stats?.[0]?.total_stat?.stats || r.data?.total_stat?.stats || {};
  return { ok: true, stats, metrics: buildMetrics(stats) };
}

// Snapchat exposes the same stats pattern for ad accounts. This is the
// authoritative source for the dashboard total and avoids under-counting when
// one of hundreds of per-campaign requests is rate-limited or times out.
export async function fetchAccountStats({accountId,token,startTime,endTime,swipeWindow,viewWindow}) {
  const url =
    `${BASE}/adaccounts/${encodeURIComponent(accountId)}/stats` +
    `?granularity=TOTAL&fields=spend` +
    `&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}` +
    `&swipe_up_attribution_window=${swipeWindow}&view_attribution_window=${viewWindow}`;

  const r = await snapFetch(url, token);
  if (!r.ok) {
    return { ok: false, status: r.status, error: r.data || r.raw || null };
  }

  const stats = r.data?.total_stats?.[0]?.total_stat?.stats ||
    r.data?.total_stat?.stats || {};

  return { ok: true, stats, metrics: buildMetrics(stats) };
}

// Runs `mapper` over `items` with at most `limit` in flight at once —
// used to fetch per-entity stats for potentially hundreds of campaigns
// without hitting Snapchat's rate limits or opening hundreds of
// concurrent connections.
export async function mapWithConcurrency(items, limit, mapper) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );

  await Promise.all(workers);

  return results;
}

// Fetches every campaign's stats individually and sums them into a single
// account-level total. Metrics that are ratios (ctr, roas, cpm, ...) are
// recomputed from the summed raw numbers rather than averaged, since
// averaging per-campaign ratios would be wrong.
//
// Returns { ok: true, metrics } on success, or { ok: false, status, error }
// on failure — callers that only care about the metrics can use
// fetchAccountSummaryMetrics() below instead.
export async function fetchAccountSummary({accountId,token,startTime,endTime,swipeWindow,viewWindow}) {
  const entitiesResult = await fetchEntities({ accountId, level: "campaign", token });

  if (!entitiesResult.ok) {
    return { ok: false, status: null, error: entitiesResult.error };
  }

  const statsResults = await mapWithConcurrency(
    entitiesResult.entities,
    6,
    (entity) => fetchEntityStats({
      level: "campaign", entityId: entity.id, token, startTime, endTime, swipeWindow, viewWindow
    })
  );

  const summedStats = statsResults.reduce((acc, result) => {
    if (!result.ok) return acc;
    for (const key of Object.keys(result.stats || {})) {
      acc[key] = (Number(acc[key]) || 0) + (Number(result.stats[key]) || 0);
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
