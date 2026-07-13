import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";
import {
  getDateRange,
  fetchAccountSummary,
  fetchEntities,
  fetchBreakdown,
  buildMetrics,
  VALID_SWIPE,
  VALID_VIEW
} from "../../../../lib/snapchatApi";

export const dynamic = "force-dynamic";

const memoryCache = new Map();
const CACHE_TTL   = 5 * 60 * 1000;

const safeNum = v  => { const n=Number(v||0); return Number.isFinite(n)?n:0; };
const div     = (a,b) => { const x=safeNum(a),y=safeNum(b); return y?x/y:0; };
const fix2    = v  => Number(safeNum(v).toFixed(2));

function cacheGet(key) {
  const c = memoryCache.get(key);
  if (!c) return null;
  if (Date.now()-c.ts > CACHE_TTL) { memoryCache.delete(key); return null; }
  return c.data;
}
function cacheSet(key,data) { memoryCache.set(key,{ts:Date.now(),data}); }

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
    const token = snapToken || await getSnapchatToken(request);
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
