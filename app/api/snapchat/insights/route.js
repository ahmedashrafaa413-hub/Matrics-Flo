import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

// Verified fields — video_views does NOT exist in Snapchat API
const FIELDS = [
  "impressions","swipes","spend",
  "conversion_purchases","conversion_purchases_value",
  "conversion_add_cart","conversion_add_billing","conversion_view_content",
  "quartile_1","quartile_2","quartile_3","view_completion","screen_time_millis",
].join(",");

const memoryCache = new Map();
const CACHE_TTL   = 5 * 60 * 1000;

const sleep   = ms => new Promise(r => setTimeout(r, ms));
const safeNum = v  => { const n=Number(v||0); return Number.isFinite(n)?n:0; };
const div     = (a,b) => { const x=safeNum(a),y=safeNum(b); return y?x/y:0; };
const micros  = v  => safeNum(v)/1_000_000;
const fix2    = v  => Number(safeNum(v).toFixed(2));
const pad     = v  => String(v).padStart(2,"0");

function cacheGet(key) {
  const c = memoryCache.get(key);
  if (!c) return null;
  if (Date.now()-c.ts > CACHE_TTL) { memoryCache.delete(key); return null; }
  return c.data;
}
function cacheSet(key,data) { memoryCache.set(key,{ts:Date.now(),data}); }

function getDateRange(preset) {
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

async function snapFetch(url, token, retries=3) {
  for (let i=0; i<=retries; i++) {
    const res  = await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
    const text = await res.text();
    if (res.status===429 && i<retries) { await sleep(1500*(i+1)); continue; }
    try   { return {ok:res.ok,status:res.status,data:JSON.parse(text)}; }
    catch { return {ok:res.ok,status:res.status,data:null,raw:text.slice(0,400)}; }
  }
  return {ok:false,status:429,data:null};
}

function buildMetrics(s={}) {
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

// Account-level summary (no breakdown param)
async function fetchAccountSummary({accountId,token,startTime,endTime,swipeWindow,viewWindow}) {
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

// Bulk breakdown — 1 call for all entities
// Confirmed structure: total_stats[0].breakdown_stats[level] = [{id, stats}]
async function fetchBreakdown({accountId,level,token,startTime,endTime,swipeWindow,viewWindow}) {
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
    // Primary confirmed path
    const items = r.data?.total_stats?.[0]?.breakdown_stats?.[level] || [];
    for (const item of items) {
      if (item?.id) statsById[item.id] = item.stats || {};
    }
    nextUrl = r.data?.total_stats?.[0]?.paging?.next_link || r.data?.paging?.next_link || null;
    pages++;
  }

  return {ok:true, statsById, pages_fetched:pages, count:Object.keys(statsById).length};
}

function normStatus(raw) {
  const s=String(raw?.status||raw?.effective_status||"").toUpperCase();
  if (["ACTIVE","RUNNING","DELIVERING","LIVE"].includes(s)) return "ACTIVE";
  if (["PAUSED","INACTIVE"].includes(s)) return "PAUSED";
  if (["PENDING","UNDER_REVIEW","IN_REVIEW"].includes(s)) return "PENDING";
  if (["DELETED","ARCHIVED"].includes(s)) return s;
  return s||"UNKNOWN";
}

async function fetchEntities({accountId,level,token}) {
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
    entities=allRaw.map(i=>{const c=i.campaign||i; return {id:c.id,name:c.name||"Unnamed",campaign_name:c.name||"Unnamed",status:normStatus(c)};});
  } else if (level==="adsquad") {
    entities=allRaw.map(i=>{const a=i.adsquad||i; return {id:a.id,name:a.name||"Unnamed",adsquad_name:a.name||"Unnamed",campaign_id:a.campaign_id||"",status:normStatus(a)};});
  } else if (level==="ad") {
    entities=allRaw.map(i=>{const a=i.ad||i; return {id:a.id,name:a.name||"Unnamed",ad_name:a.name||"Unnamed",adsquad_id:a.ad_squad_id||a.adsquad_id||"",status:normStatus(a)};});
  }
  return {ok:true,entities,pages_fetched:pages};
}

function buildSummaryFromRows(rows) {
  const t=rows.reduce((a,r)=>({
    spend:a.spend+safeNum(r.spend),revenue:a.revenue+safeNum(r.revenue),
    purchases:a.purchases+safeNum(r.purchases),atc:a.atc+safeNum(r.add_to_cart),
    ic:a.ic+safeNum(r.initiate_checkout),
    imp:a.imp+safeNum(r.impressions),sw:a.sw+safeNum(r.swipes),
    q1:a.q1+safeNum(r.quartile_1),q3:a.q3+safeNum(r.quartile_3),
    vcomp:a.vcomp+safeNum(r.view_completion),
  }),{spend:0,revenue:0,purchases:0,atc:0,ic:0,imp:0,sw:0,q1:0,q3:0,vcomp:0});
  return {
    spend:fix2(t.spend),revenue:fix2(t.revenue),purchase_value:fix2(t.revenue),
    purchases:t.purchases,add_to_cart:t.atc,initiate_checkout:t.ic,
    impressions:t.imp,swipes:t.sw,clicks:t.sw,
    quartile_1:t.q1,quartile_3:t.q3,view_completion:t.vcomp,
    roas:fix2(div(t.revenue,t.spend)),cpa:fix2(div(t.spend,t.purchases)),
    cost_per_atc:fix2(div(t.spend,t.atc)),
    ctr:fix2(div(t.sw,t.imp)*100),cpc:fix2(div(t.spend,t.sw)),cpm:fix2(div(t.spend,t.imp)*1000),
    hook_rate:fix2(div(t.q1,t.imp)*100),hold_rate:fix2(div(t.q3,t.q1)*100),
    completion_rate:fix2(div(t.vcomp,t.imp)*100),
  };
}

const VALID_SWIPE=["1_DAY","7_DAY","28_DAY"];
const VALID_VIEW =["1_HOUR","3_HOUR","6_HOUR","1_DAY","7_DAY","28_DAY"];

export async function GET(request) {
  try {
    const {searchParams}=new URL(request.url);
    const accountId  = searchParams.get("account_id");
    const level      = searchParams.get("level")       || "campaign";
    const datePreset = searchParams.get("date_preset") || "last_30d";
    const force      = searchParams.get("force")       === "1";
    const snapToken  = searchParams.get("snap_token")  || null;

    const swRaw=searchParams.get("swipe_window")||"28_DAY";
    const vwRaw=searchParams.get("view_window") ||"1_DAY";
    const swipeWindow=VALID_SWIPE.includes(swRaw)?swRaw:"28_DAY";
    const viewWindow =VALID_VIEW.includes(vwRaw) ?vwRaw :"1_DAY";

    if (!accountId) return NextResponse.json({success:false,error:"account_id is required"},{status:400});

    const cacheKey=`snap:${accountId}:${level}:${datePreset}:${swipeWindow}:${viewWindow}`;
    if (!force) {
      const cached=cacheGet(cacheKey);
      if (cached) return NextResponse.json({...cached,cached:true});
    }

    // Use cookie-based token (no parameters) — this is what actually works
    const token = snapToken || await getSnapchatToken();
    if (!token) return NextResponse.json({success:false,error:"Not connected to Snapchat"},{status:401});

    const {startTime,endTime}=getDateRange(datePreset);

    // 3 parallel calls
    const [accountSummary, entitiesResult, breakdownResult] = await Promise.all([
      fetchAccountSummary({accountId,token,startTime,endTime,swipeWindow,viewWindow}),
      fetchEntities({accountId,level,token}),
      fetchBreakdown({accountId,level,token,startTime,endTime,swipeWindow,viewWindow}),
    ]);

    if (!entitiesResult.ok) {
      return NextResponse.json({success:false,error:entitiesResult.error},{status:500});
    }

    const allEntities=entitiesResult.entities;
    let rows=[];

    if (breakdownResult.ok && breakdownResult.count>0) {
      // Fast path: breakdown worked
      rows=allEntities
        .map(e=>({...e,...buildMetrics(breakdownResult.statsById[e.id]||{})}))
        .filter(r=>safeNum(r.spend)>0.001)
        .sort((a,b)=>safeNum(b.spend)-safeNum(a.spend));
    }
    // If breakdown returned 0 items but entities exist, rows stays empty
    // and summary comes from accountSummary (which always works)

    const summary=accountSummary||buildSummaryFromRows(rows);

    const payload={
      success:true, provider:"Snapchat Ads",
      account_id:accountId, level, date_preset:datePreset,
      start_time:startTime, end_time:endTime,
      attribution:{swipe_window:swipeWindow,view_window:viewWindow},
      total_entities:allEntities.length,
      active_entities:allEntities.filter(e=>e.status==="ACTIVE").length,
      loaded_count:rows.length,
      breakdown_count:breakdownResult.count||0,
      summary, data:rows,
    };

    cacheSet(cacheKey,payload);
    return NextResponse.json(payload);
  } catch(err) {
    return NextResponse.json({success:false,error:err.message},{status:500});
  }
}
