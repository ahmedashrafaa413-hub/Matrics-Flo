import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";

export const dynamic = "force-dynamic";

const BASE = "https://adsapi.snapchat.com/v1";

// Verified Snapchat field names
const FIELDS = [
  "impressions","spend","swipes","swipe_up_percent",
  "conversion_purchases","conversion_purchases_value",
  "conversion_add_billing",
  "video_views","video_views_15s","view_completion",
  "quartile_1","quartile_3",
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

function extractStats(payload,id) {
  const arr   = payload?.total_stats||[];
  const match = arr.find(i=>{const s=i.total_stat||i; return s.id===id||s.campaign_id===id||s.ad_squad_id===id||s.ad_id===id;})||arr[0]||null;
  return match?.total_stat?.stats||match?.stats||{};
}

function buildMetrics(s) {
  const spend=micros(s.spend),rev=micros(s.conversion_purchases_value);
  const pur=safeNum(s.conversion_purchases),atc=safeNum(s.conversion_add_billing||s.conversion_add_cart||0);
  const imp=safeNum(s.impressions),sw=safeNum(s.swipes);
  const vv=safeNum(s.video_views),vv15=safeNum(s.video_views_15s),vc=safeNum(s.view_completion);
  return {
    spend:fix2(spend),revenue:fix2(rev),purchase_value:fix2(rev),
    purchases:pur,add_to_cart:atc,
    impressions:imp,swipes:sw,clicks:sw,
    video_views:vv,video_views_15s:vv15,view_completion:vc,
    roas:fix2(divide(rev,spend)),cpa:fix2(divide(spend,pur)),cost_per_atc:fix2(divide(spend,atc)),
    ctr:fix2(divide(sw,imp)*100),cpc:fix2(divide(spend,sw)),cpm:fix2(divide(spend,imp)*1000),
    hook_rate:fix2(divide(vv,imp)*100),
    hold_rate:fix2(divide(vv15,vv)*100),
    completion_rate:fix2(divide(vc,vv)*100),
    video_view_rate:fix2(divide(vv,imp)*100),
  };
}

async function fetchAccountSummary({accountId,token,startTime,endTime}) {
  const url=`${BASE}/adaccounts/${accountId}/stats?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;
  const r=await snapFetch(url,token);
  if (!r.ok) return null;
  return buildMetrics(extractStats(r.data,accountId));
}

async function fetchOneStats({entityType,entityId,token,startTime,endTime}) {
  const url=`${BASE}/${entityType}/${entityId}/stats?granularity=TOTAL&fields=${encodeURIComponent(FIELDS)}&start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}`;
  const r=await snapFetch(url,token);
  if (!r.ok) return {status:r.status,stats:{}};
  return {status:r.status,stats:extractStats(r.data,entityId)};
}

async function fetchStatsParallel({entities,entityType,token,startTime,endTime}) {
  const statsMap={};let rateLimited=false;
  for (let i=0;i<entities.length;i+=BATCH_SIZE) {
    if (rateLimited) break;
    const batch=entities.slice(i,i+BATCH_SIZE);
    await Promise.all(batch.map(async e=>{
      try {
        const r=await fetchOneStats({entityType,entityId:e.id,token,startTime,endTime});
        statsMap[e.id]=r.stats||{};
        if (r.status===429) rateLimited=true;
      } catch { statsMap[e.id]={}; }
    }));
    if (i+BATCH_SIZE<entities.length && !rateLimited) await sleep(BATCH_DELAY);
  }
  return {statsMap,rateLimited};
}

function normStatus(raw) {
  const s=String(raw?.status||raw?.effective_status||raw?.delivery_status||"").toUpperCase();
  if (["ACTIVE","RUNNING","DELIVERING","LIVE"].includes(s)) return "ACTIVE";
  if (["PAUSED","INACTIVE","AD_PAUSED","CAMPAIGN_PAUSED","ADSQUAD_PAUSED"].includes(s)) return "PAUSED";
  if (["PENDING","UNDER_REVIEW","IN_REVIEW","REVIEW"].includes(s)) return "PENDING";
  if (["DELETED","ARCHIVED"].includes(s)) return s;
  return s||"ACTIVE";
}

async function fetchEntities({accountId,level,token}) {
  const pathMap={campaign:"campaigns",adsquad:"adsquads",ad:"ads"};
  const path=pathMap[level]||"campaigns";
  let allRaw=[],nextUrl=`${BASE}/adaccounts/${accountId}/${path}?limit=200`,pages=0;
  while (nextUrl && pages<15) {
    const r=await snapFetch(nextUrl,token);
    if (!r.ok) { if (pages===0) return {ok:false,status:r.status,error:r.data||r.raw,entities:[]}; break; }
    allRaw=allRaw.concat(r.data?.[path]||[]);
    nextUrl=r.data?.paging?.next_link||null;
    pages++;
  }
  let entities=[];
  if (level==="campaign") {
    entities=allRaw.map(i=>{const c=i.campaign||i;return {id:c.id,name:c.name||"Unnamed",campaign_name:c.name||"Unnamed",status:normStatus(c)};});
  } else if (level==="adsquad") {
    entities=allRaw.map(i=>{const a=i.adsquad||i;return {id:a.id,name:a.name||"Unnamed",adsquad_name:a.name||"Unnamed",campaign_id:a.campaign_id||"",status:normStatus(a)};});
  } else if (level==="ad") {
    entities=allRaw.map(i=>{const a=i.ad||i;return {id:a.id,name:a.name||"Unnamed",ad_name:a.name||"Unnamed",adsquad_id:a.ad_squad_id||a.adsquad_id||"",status:normStatus({status:a.status||a.effective_status||"ACTIVE"})};});
  }
  return {ok:true,entities,pages_fetched:pages};
}

function buildSummaryFromRows(rows) {
  const t=rows.reduce((a,r)=>({
    spend:a.spend+safeNum(r.spend),revenue:a.revenue+safeNum(r.revenue),
    purchases:a.purchases+safeNum(r.purchases),atc:a.atc+safeNum(r.add_to_cart),
    imp:a.imp+safeNum(r.impressions),sw:a.sw+safeNum(r.swipes),
    vv:a.vv+safeNum(r.video_views),vv15:a.vv15+safeNum(r.video_views_15s),vc:a.vc+safeNum(r.view_completion),
  }),{spend:0,revenue:0,purchases:0,atc:0,imp:0,sw:0,vv:0,vv15:0,vc:0});
  return {
    spend:fix2(t.spend),revenue:fix2(t.revenue),purchase_value:fix2(t.revenue),
    purchases:t.purchases,add_to_cart:t.atc,impressions:t.imp,swipes:t.sw,clicks:t.sw,
    video_views:t.vv,video_views_15s:t.vv15,
    roas:fix2(divide(t.revenue,t.spend)),cpa:fix2(divide(t.spend,t.purchases)),
    cost_per_atc:fix2(divide(t.spend,t.atc)),
    ctr:fix2(divide(t.sw,t.imp)*100),cpc:fix2(divide(t.spend,t.sw)),cpm:fix2(divide(t.spend,t.imp)*1000),
    hook_rate:fix2(divide(t.vv,t.imp)*100),hold_rate:fix2(divide(t.vv15,t.vv)*100),
    completion_rate:fix2(divide(t.vc,t.vv)*100),video_view_rate:fix2(divide(t.vv,t.imp)*100),
  };
}

export async function GET(request) {
  const {searchParams}=new URL(request.url);
  const accountId  = searchParams.get("account_id");
  const level      = searchParams.get("level")       ||"campaign";
  const datePreset = searchParams.get("date_preset") ||"last_30d";
  const force      = searchParams.get("force")       ==="1";
  const snapToken  = searchParams.get("snap_token")  ||null;

  if (!accountId) return NextResponse.json({success:false,error:"account_id is required"});

  const cacheKey=`${accountId}:${level}:${datePreset}`;
  if (!force) { const cached=cacheGet(cacheKey); if (cached) return NextResponse.json({...cached,cached:true}); }

  const token=snapToken||await getSnapchatToken();
  if (!token) return NextResponse.json({success:false,error:"Not connected to Snapchat"});

  const {startTime,endTime}=getDateRange(datePreset);
  const entityType={campaign:"campaigns",adsquad:"adsquads",ad:"ads"}[level]||"campaigns";

  const [accountSummary,entitiesResult]=await Promise.all([
    fetchAccountSummary({accountId,token,startTime,endTime}),
    fetchEntities({accountId,level,token}),
  ]);

  if (!entitiesResult.ok) return NextResponse.json({success:false,error:entitiesResult.error});

  const allEntities=entitiesResult.entities;
  const shortRange=["today","yesterday","last_7d"].includes(datePreset);
  const skipStatus=["DELETED","ARCHIVED"];
  const toLoad=shortRange
    ? allEntities.filter(e=>e.status==="ACTIVE")
    : allEntities.filter(e=>!skipStatus.includes(e.status));

  const {statsMap,rateLimited}=await fetchStatsParallel({entities:toLoad,entityType,token,startTime,endTime});

  const allRows=toLoad.map(e=>({...e,...buildMetrics(statsMap[e.id]||{})}));
  const rows=allRows.filter(r=>safeNum(r.spend)>0.001).sort((a,b)=>safeNum(b.spend)-safeNum(a.spend));
  const summary=accountSummary||buildSummaryFromRows(rows);

  const payload={
    success:true,provider:"Snapchat Ads",account_id:accountId,level,date_preset:datePreset,
    start_time:startTime,end_time:endTime,
    total_entities:allEntities.length,active_entities:allEntities.filter(e=>e.status==="ACTIVE").length,
    loaded_count:rows.length,pages_fetched:entitiesResult.pages_fetched,rate_limited:rateLimited,
    summary,data:rows,
  };
  cacheSet(cacheKey,payload);
  return NextResponse.json(payload);
}
