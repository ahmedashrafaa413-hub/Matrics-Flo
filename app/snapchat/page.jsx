"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const SNAP_YELLOW = "#FFFC00";
const SAR_RATE    = 3.75;

const DATE_OPTIONS = [
  { value:"today",      label:"Today"        },
  { value:"yesterday",  label:"Yesterday"    },
  { value:"last_7d",    label:"Last 7 Days"  },
  { value:"last_30d",   label:"Last 30 Days" },
  { value:"this_month", label:"This Month"   },
  { value:"last_90d",   label:"Last 90 Days" },
  { value:"maximum",    label:"Maximum"      },
];

const TABS = [
  { key:"overview",  label:"Overview",  icon:"⬡" },
  { key:"campaigns", label:"Campaigns", icon:"◈" },
  { key:"adsquads",  label:"Ad Squads", icon:"◫" },
  { key:"ads",       label:"Ads",       icon:"▣" },
  { key:"creative",  label:"Creative",  icon:"✦" },
];

const n   = v => Number(v||0);
const fix = (v,d=2) => n(v).toFixed(d);
const fmt = {
  usd:     v => `$${fix(v)}`,
  sar:     v => `${fix(n(v)*SAR_RATE)} SAR`,
  pct:     v => `${fix(v)}%`,
  x:       v => `${fix(v)}x`,
  num:     v => n(v).toLocaleString(),
  compact: v => { const x=n(v); return x>=1e6?`${fix(x/1e6,1)}M`:x>=1e3?`${fix(x/1e3,1)}K`:x.toLocaleString(); },
};

const roasColor = v => n(v)>=3?"#06d6a0":n(v)>=1?"#f59e0b":"#f43f5e";
const ctrColor  = v => n(v)>=1?"#06d6a0":n(v)>=0.5?"#f59e0b":"#f43f5e";
const hookColor = v => n(v)>=25?"#06d6a0":n(v)>=15?"#f59e0b":"#f43f5e";
const holdColor = v => n(v)>=40?"#06d6a0":n(v)>=25?"#f59e0b":"#f43f5e";

// NOTE: hook_rate = quartile_1/impressions, hold_rate = quartile_3/quartile_1, completion_rate = view_completion/impressions
// These are real Snapchat API fields (video_views / video_views_15s do NOT exist in the API)

function diagnoseSnap(row) {
  const spend=n(row.spend),roas=n(row.roas),pur=n(row.purchases);
  const hook=n(row.hook_rate),hold=n(row.hold_rate),ctr=n(row.ctr);
  const atc=n(row.add_to_cart);
  if (roas>=3&&pur>=3&&hook>=20) return {badge:"Winner",    color:"#f59e0b",bg:"rgba(245,158,11,0.1)", action:"Scale budget 20%. Create 3 variations of this angle."};
  if (hook>0&&hook<12)           return {badge:"Hook Issue", color:"#f43f5e",bg:"rgba(244,63,94,0.1)",  action:"Fix first 3s. Show outcome immediately. Try bold claim or question."};
  if (hook>=20&&hold<20)         return {badge:"Hold Issue", color:"#f59e0b",bg:"rgba(245,158,11,0.1)", action:"Shorten video. Add text overlays earlier. Show proof in first 5s."};
  if (hook>=18&&hold>=20&&ctr<0.5) return {badge:"Swipe Issue",color:"#6366f1",bg:"rgba(99,102,241,0.1)",action:"Stronger CTA. Clearer offer. Add urgency or social proof."};
  if (spend>50&&roas<0.8&&pur===0) return {badge:"Losing",   color:"#f43f5e",bg:"rgba(244,63,94,0.1)",  action:"Pause. Review hook, offer, targeting before relaunching."};
  if (atc>0&&pur/atc<0.2)        return {badge:"Checkout Drop",color:"#f59e0b",bg:"rgba(245,158,11,0.1)",action:"Retarget ATC. Review payment options and checkout friction."};
  return                               {badge:"Monitor",    color:"#8b95c9",bg:"rgba(139,149,201,0.08)",action:"Wait for more data before deciding."};
}

function StatusDot({status}) {
  if (!status) return null;
  const s=String(status).toUpperCase();
  const c=s==="ACTIVE"?"#06d6a0":s==="PAUSED"?"#f59e0b":s==="PENDING"?"#6366f1":"#7b88b8";
  const l=s==="ACTIVE"?"Active":s==="PAUSED"?"Paused":s==="PENDING"?"Pending":status;
  return (<span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:999,fontSize:11,fontWeight:700,color:c,background:`${c}12`,border:`1px solid ${c}25`,whiteSpace:"nowrap"}}>
    <span style={{width:5,height:5,borderRadius:"50%",background:c,boxShadow:s==="ACTIVE"?`0 0 5px ${c}`:"none"}}/>{l}
  </span>);
}

function KPICard({label,value,sub,color,icon}) {
  return (
    <div className="dash-kpi-card" style={{position:"relative"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:color,borderRadius:"20px 20px 0 0"}}/>
      <div className="dash-kpi-top">
        <span className="dash-kpi-label">{label}</span>
        <span style={{fontSize:16}}>{icon}</span>
      </div>
      <strong style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:22,color:"var(--text)",display:"block"}}>{value}</strong>
      {sub && <div style={{fontSize:11,color:"var(--muted)",marginTop:4}}>{sub}</div>}
    </div>
  );
}

function ChartTip({active,payload,label}) {
  if (!active||!payload?.length) return null;
  return (<div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
    <p style={{color:"var(--muted)",fontSize:11,marginBottom:6}}>{label}</p>
    {payload.map((p,i)=><p key={i} style={{color:p.color,fontWeight:700,fontSize:12}}>{p.name}: {n(p.value).toLocaleString()}</p>)}
  </div>);
}

function SnapTable({title,loading,rows,showHook=false}) {
  const [sortKey,setSort]=useState("spend");
  const [sortDir,setSortDir]=useState("desc");
  const [statusF,setStatusF]=useState("all");

  function toggleSort(k) {
    if (sortKey===k) setSortDir(d=>d==="asc"?"desc":"asc");
    else {setSort(k);setSortDir("desc");}
  }

  const filtered=useMemo(()=>{
    let list=[...rows];
    if (statusF==="active") list=list.filter(r=>String(r.status).toUpperCase()==="ACTIVE");
    if (statusF==="paused") list=list.filter(r=>String(r.status).toUpperCase()==="PAUSED");
    list.sort((a,b)=>sortDir==="asc"?n(a[sortKey])-n(b[sortKey]):n(b[sortKey])-n(a[sortKey]));
    return list;
  },[rows,sortKey,sortDir,statusF]);

  const Th=({k,children})=>(<th onClick={()=>toggleSort(k)} style={{cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"}}>{children}{sortKey===k?(sortDir==="asc"?" ↑":" ↓"):""}</th>);

  return (
    <div className="dash-table-card">
      <div className="dash-table-head">
        <div><h2>{title}</h2><p>{loading?"Loading...":filtered.length+" rows"}</p></div>
        <div style={{display:"flex",gap:6}}>
          {["all","active","paused"].map(f=>(
            <button key={f} onClick={()=>setStatusF(f)} style={{padding:"5px 12px",borderRadius:999,fontSize:11,fontWeight:700,border:`1px solid ${statusF===f?"var(--primary)":"var(--border)"}`,background:statusF===f?"rgba(99,102,241,0.12)":"transparent",color:statusF===f?"var(--primary)":"var(--muted)",cursor:"pointer",fontFamily:"inherit"}}>
              {f==="all"?"All":f==="active"?"🟢 Active":"🟡 Paused"}
            </button>
          ))}
        </div>
      </div>
      {loading?<div className="dash-empty"><h3>Loading...</h3></div>:filtered.length===0?<div className="dash-empty"><h3>No data</h3></div>:(
        <div className="dash-table-scroll">
          <table className="dash-data-table">
            <thead><tr>
              <th>Name</th><th>Status</th>
              <Th k="spend">Spend (SAR)</Th><Th k="revenue">Revenue (SAR)</Th>
              <Th k="roas">ROAS</Th><Th k="purchases">Purchases</Th><Th k="add_to_cart">ATC</Th>
              <Th k="cpa">CPA (SAR)</Th><Th k="impressions">Impressions</Th><Th k="swipes">Swipes</Th>
              <Th k="ctr">CTR</Th><Th k="cpm">CPM</Th>
              {showHook&&<><Th k="hook_rate">Hook%</Th><Th k="hold_rate">Hold%</Th><Th k="completion_rate">Comp%</Th></>}
            </tr></thead>
            <tbody>
              {filtered.map((row,i)=>(
                <tr key={row.id||i}>
                  <td className="dash-name-cell">{row.ad_name||row.adsquad_name||row.campaign_name||row.name}</td>
                  <td><StatusDot status={row.status}/></td>
                  <td>{fmt.sar(row.spend)}</td>
                  <td>{fmt.sar(row.revenue||row.purchase_value)}</td>
                  <td style={{color:roasColor(row.roas),fontWeight:700}}>{fmt.x(row.roas)}</td>
                  <td>{fmt.num(row.purchases)}</td>
                  <td>{fmt.num(row.add_to_cart||0)}</td>
                  <td>{fmt.sar(row.cpa)}</td>
                  <td>{fmt.compact(row.impressions)}</td>
                  <td>{fmt.compact(row.swipes||row.clicks)}</td>
                  <td style={{color:ctrColor(row.ctr),fontWeight:700}}>{fmt.pct(row.ctr)}</td>
                  <td>{fmt.sar(row.cpm)}</td>
                  {showHook&&<><td style={{color:hookColor(row.hook_rate),fontWeight:700}}>{row.hook_rate>0?fmt.pct(row.hook_rate):"—"}</td><td style={{color:holdColor(row.hold_rate),fontWeight:700}}>{row.hold_rate>0?fmt.pct(row.hold_rate):"—"}</td><td>{row.completion_rate>0?fmt.pct(row.completion_rate):"—"}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreativeGallery({rows}) {
  const [filter,setFilter]=useState("all");
  const diagnosed=useMemo(()=>rows.map(r=>({...r,_diag:diagnoseSnap(r)})).sort((a,b)=>{
    const ord={"Winner":0,"Losing":1,"Hook Issue":2,"Hold Issue":3,"Swipe Issue":3,"Checkout Drop":3,"Monitor":4};
    return (ord[a._diag.badge]??5)-(ord[b._diag.badge]??5)||(n(b.roas)-n(a.roas));
  }),[rows]);
  const filtered=useMemo(()=>{
    if (filter==="all")     return diagnosed;
    if (filter==="winners") return diagnosed.filter(r=>r._diag.badge==="Winner");
    if (filter==="hook")    return diagnosed.filter(r=>r._diag.badge==="Hook Issue");
    if (filter==="losing")  return diagnosed.filter(r=>r._diag.badge==="Losing");
    if (filter==="nopurch") return diagnosed.filter(r=>n(r.purchases)===0);
    return diagnosed;
  },[diagnosed,filter]);
  const totalSpend=rows.reduce((s,r)=>s+n(r.spend),0);
  const totalRev=rows.reduce((s,r)=>s+n(r.revenue),0);
  const totalPur=rows.reduce((s,r)=>s+n(r.purchases),0);
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
        {[{label:"Total Spend",val:fmt.sar(totalSpend),color:"#f59e0b"},{label:"Total Revenue",val:fmt.sar(totalRev),color:"#06d6a0"},{label:"Purchases",val:fmt.num(totalPur),color:"#6366f1"},{label:"Winners",val:diagnosed.filter(r=>r._diag.badge==="Winner").length,color:"#f59e0b"},{label:"Losing",val:diagnosed.filter(r=>r._diag.badge==="Losing").length,color:"#f43f5e"}].map(k=>(
          <div key={k.label} className="dash-kpi-card" style={{padding:"12px 14px",position:"relative"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:k.color,borderRadius:"14px 14px 0 0"}}/>
            <div style={{fontSize:9,fontWeight:700,color:"var(--muted)",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:900,color:k.color,fontFamily:"'Space Grotesk',sans-serif"}}>{k.val}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {[{k:"all",l:"All"},{k:"winners",l:"🏆 Winners"},{k:"hook",l:"🎬 Hook Issue"},{k:"losing",l:"🔴 Losing"},{k:"nopurch",l:"💸 No Purchase"}].map(f=>(
          <button key={f.k} onClick={()=>setFilter(f.k)} style={{padding:"6px 14px",borderRadius:999,fontSize:11,fontWeight:700,border:`1px solid ${filter===f.k?"#FFFC00":"var(--border)"}`,background:filter===f.k?"rgba(255,252,0,0.1)":"transparent",color:filter===f.k?"#FFFC00":"var(--muted)",cursor:"pointer",fontFamily:"inherit"}}>{f.l}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:14}} className="snap-creative-grid">
        {filtered.map((row,i)=>{
          const d=row._diag;
          return (
            <div key={row.id||i} style={{background:"var(--card)",border:`1px solid ${d.badge==="Winner"?"rgba(245,158,11,0.3)":d.badge==="Losing"?"rgba(244,63,94,0.2)":"var(--border)"}`,borderRadius:18,overflow:"hidden",display:"flex",flexDirection:"column"}}>
              <div style={{height:110,background:"rgba(255,255,255,0.03)",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                <span style={{fontSize:28,opacity:0.2}}>👻</span>
                <div style={{position:"absolute",top:8,left:8}}><StatusDot status={row.status}/></div>
                <div style={{position:"absolute",top:8,right:8,padding:"3px 9px",borderRadius:999,fontSize:10,fontWeight:700,color:d.color,background:d.bg,border:`1px solid ${d.color}30`}}>{d.badge==="Winner"?"🏆 Winner":d.badge==="Losing"?"🔴 Losing":d.badge==="Hook Issue"?"🎬 Hook Issue":d.badge==="Hold Issue"?"⏱ Hold Issue":d.badge==="Swipe Issue"?"👆 Swipe Issue":d.badge==="Checkout Drop"?"🛒 Checkout Drop":"⚪ Monitor"}</div>
              </div>
              <div style={{padding:14,display:"flex",flexDirection:"column",gap:10,flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.ad_name||row.name||"Unnamed"}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                  {[{l:"Spend",v:fmt.sar(row.spend)},{l:"Revenue",v:fmt.sar(row.revenue),c:n(row.roas)>=2?"#06d6a0":undefined},{l:"ROAS",v:fmt.x(row.roas),c:roasColor(row.roas)},{l:"Purchases",v:fmt.num(row.purchases)},{l:"ATC",v:fmt.num(row.add_to_cart||0)},{l:"CTR",v:fmt.pct(row.ctr),c:ctrColor(row.ctr)}].map(m=>(
                    <div key={m.l} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"6px 8px"}}>
                      <div style={{fontSize:9,color:"var(--muted)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>{m.l}</div>
                      <div style={{fontSize:12,fontWeight:700,color:m.c||"var(--text)"}}>{m.v}</div>
                    </div>
                  ))}
                </div>
                {n(row.hook_rate)>0&&(
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                    {[{l:"Hook%",v:fmt.pct(row.hook_rate),c:hookColor(row.hook_rate)},{l:"Hold%",v:n(row.hold_rate)>0?fmt.pct(row.hold_rate):"—",c:n(row.hold_rate)>0?holdColor(row.hold_rate):undefined},{l:"Comp%",v:n(row.completion_rate)>0?fmt.pct(row.completion_rate):"—"}].map(m=>(
                      <div key={m.l} style={{background:"rgba(99,102,241,0.06)",border:"1px solid rgba(99,102,241,0.12)",borderRadius:8,padding:"6px 8px"}}>
                        <div style={{fontSize:9,color:"var(--muted)",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>{m.l}</div>
                        <div style={{fontSize:12,fontWeight:700,color:m.c||"var(--text)"}}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{background:d.bg,border:`1px solid ${d.color}25`,borderRadius:10,padding:"10px 12px",fontSize:11,color:"var(--text-2)"}}>
                  <strong style={{color:"var(--text)"}}>Action: </strong>{d.action}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length===0&&<div className="dash-empty" style={{gridColumn:"1/-1"}}><h3>No ads match this filter</h3></div>}
      </div>
    </div>
  );
}

export default function SnapchatPage() {
  const [accounts,   setAccounts]   = useState([]);
  const [accountId,  setAccountId]  = useState("");
  const [activeTab,  setActiveTab]  = useState("overview");
  const [datePreset, setDatePreset] = useState("last_30d");
  const [connected,  setConnected]  = useState(true);
  const [error,      setError]      = useState("");
  const [campRows,   setCampRows]   = useState([]);
  const [campSum,    setCampSum]    = useState(null);
  const [campLoad,   setCampLoad]   = useState(false);
  const [squadRows,  setSquadRows]  = useState([]);
  const [squadLoaded,setSquadLoaded]= useState(false);
  const [squadLoad,  setSquadLoad]  = useState(false);
  const [adRows,     setAdRows]     = useState([]);
  const [adLoaded,   setAdLoaded]   = useState(false);
  const [adLoad,     setAdLoad]     = useState(false);
  const campRef=useRef(""),squadRef=useRef(""),adRef=useRef(""),lastRef=useRef(0);
  const loading=campLoad||squadLoad||adLoad;

  useEffect(()=>{loadAccounts();},[]);
  useEffect(()=>{if(!accountId)return;resetData();loadCamp(accountId);},[accountId,datePreset]);
  useEffect(()=>{
    if (!accountId) return;
    if (activeTab==="adsquads"&&!squadLoaded&&!squadLoad) loadSquad(accountId);
    if ((activeTab==="ads"||activeTab==="creative")&&!adLoaded&&!adLoad) loadAds(accountId);
  },[activeTab,accountId]);

  function resetData(){setCampRows([]);setCampSum(null);setSquadRows([]);setSquadLoaded(false);setAdRows([]);setAdLoaded(false);setError("");campRef.current="";squadRef.current="";adRef.current="";}

  async function loadAccounts(){
    try{
      const d=await apiGet("/api/snapchat/accounts");
      const list=d.data||[];setAccounts(list);
      const saved=getSetting("primary_snapchat_account","");
      const sel=list.find(a=>a.id===saved)?.id||list[0]?.id||"";
      setAccountId(sel);if(sel)saveSetting("primary_snapchat_account",sel);
      setConnected(list.length>0);
    }catch(e){setConnected(false);setError(e.message);}
  }

  async function loadCamp(acId=accountId){
    if(!acId||campLoad)return;
    const key=`${acId}|camp|${datePreset}`;
    if(campRef.current===key)return;
    campRef.current=key;setCampLoad(true);setError("");
    try{const d=await apiGet(`/api/snapchat/insights?account_id=${acId}&level=campaign&date_preset=${datePreset}`);setCampRows(d.data||[]);setCampSum(d.summary||null);}
    catch(e){setCampRows([]);setCampSum(null);setError(e.message);campRef.current="";}
    finally{setCampLoad(false);}
  }

  async function loadSquad(acId=accountId){
    if(!acId||squadLoad)return;
    const key=`${acId}|squad|${datePreset}`;
    if(squadRef.current===key)return;
    squadRef.current=key;setSquadLoad(true);setError("");
    try{const d=await apiGet(`/api/snapchat/insights?account_id=${acId}&level=adsquad&date_preset=${datePreset}`);setSquadRows(d.data||[]);setSquadLoaded(true);}
    catch(e){setSquadRows([]);setSquadLoaded(false);setError(e.message);squadRef.current="";}
    finally{setSquadLoad(false);}
  }

  async function loadAds(acId=accountId){
    if(!acId||adLoad)return;
    const key=`${acId}|ad|${datePreset}`;
    if(adRef.current===key)return;
    adRef.current=key;setAdLoad(true);setError("");
    try{const d=await apiGet(`/api/snapchat/insights?account_id=${acId}&level=ad&date_preset=${datePreset}`);setAdRows(d.data||[]);setAdLoaded(true);}
    catch(e){setAdRows([]);setAdLoaded(false);setError(e.message);adRef.current="";}
    finally{setAdLoad(false);}
  }

  async function refresh(){
    if(loading)return;
    const now=Date.now();if(now-lastRef.current<30000){setError("Wait 30s before refreshing.");return;}
    lastRef.current=now;campRef.current="";squadRef.current="";adRef.current="";
    setCampRows([]);setCampSum(null);setSquadRows([]);setSquadLoaded(false);setAdRows([]);setAdLoaded(false);setError("");
    await loadCamp(accountId);
    if(activeTab==="adsquads") await loadSquad(accountId);
    if(activeTab==="ads"||activeTab==="creative") await loadAds(accountId);
  }

  const totals=campSum||{};
  const chartData=useMemo(()=>campRows.slice(0,8).map(r=>({name:(r.name||r.campaign_name||"Unknown").slice(0,14),spend:n(r.spend)*SAR_RATE,revenue:n(r.revenue)*SAR_RATE,swipes:n(r.swipes||r.clicks)})),[campRows]);

  if(!connected) return (
    <main style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:300,gap:16}}>
      <div style={{width:56,height:56,borderRadius:16,background:"rgba(255,252,0,0.1)",border:"1px solid rgba(255,252,0,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>👻</div>
      <h1 style={{color:"var(--text)",fontFamily:"'Space Grotesk',sans-serif"}}>Snapchat not connected</h1>
      <a href="/connections" style={{background:"linear-gradient(135deg,#FFFC00,#E6E300)",color:"#000",padding:"11px 24px",borderRadius:14,fontWeight:700,fontSize:13,textDecoration:"none"}}>Connect Snapchat →</a>
    </main>
  );

  return (
    <main style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}} className="snap-header">
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:38,height:38,borderRadius:10,background:"rgba(255,252,0,0.1)",border:"1px solid rgba(255,252,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>👻</div>
          <div>
            <h1 style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:20,fontWeight:700,color:"var(--text)"}}>Snapchat Ads</h1>
            <p style={{fontSize:12,color:"var(--muted)"}}>{accounts.find(a=>a.id===accountId)?.name||"No account"}</p>
            <p style={{fontSize:10,color:"#06d6a0",fontWeight:700}}>Display: SAR (USD × 3.75) • Attribution: 28d swipe / 1d view</p>
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}} className="snap-controls">
          {accounts.length>0&&(
            <select value={accountId} onChange={e=>{setAccountId(e.target.value);saveSetting("primary_snapchat_account",e.target.value);}} disabled={loading}>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name} — {a.currency}</option>)}
            </select>
          )}
          <select value={datePreset} onChange={e=>setDatePreset(e.target.value)} disabled={loading}>
            {DATE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="dash-refresh" onClick={refresh} disabled={loading}>{loading?"⏳":"↺"} Refresh</button>
        </div>
      </div>

      <div style={{display:"flex",gap:4,background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:4}} className="snap-tabs">
        {TABS.map(tab=>(
          <button key={tab.key} onClick={()=>setActiveTab(tab.key)} style={{flex:1,padding:"8px 10px",borderRadius:12,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:activeTab===tab.key?700:500,background:activeTab===tab.key?"var(--card-2)":"transparent",color:activeTab===tab.key?"var(--text)":"var(--muted)",borderBottom:activeTab===tab.key?`2px solid ${SNAP_YELLOW}`:"2px solid transparent"}}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {error&&<div className="dash-message error">⚠ {error}</div>}

      {activeTab==="overview"&&(
        <>
          <div className="dash-kpi-grid">
            <KPICard label="Spend"       value={campLoad?"—":fmt.sar(totals.spend)}           sub={`$${fix(n(totals.spend))}`}    color={SNAP_YELLOW} icon="💰"/>
            <KPICard label="Revenue"     value={campLoad?"—":fmt.sar(totals.revenue)}          sub={`$${fix(n(totals.revenue))}`}  color="#06d6a0"     icon="💵"/>
            <KPICard label="ROAS"        value={campLoad?"—":fmt.x(totals.roas)}               color={roasColor(totals.roas)}      icon="📈"/>
            <KPICard label="Purchases"   value={campLoad?"—":fmt.num(totals.purchases)}        color="#06d6a0"                     icon="🛒"/>
            <KPICard label="Add to Cart" value={campLoad?"—":fmt.num(totals.add_to_cart||0)}   color="#f59e0b"                     icon="🛍️"/>
            <KPICard label="CPA (SAR)"   value={campLoad?"—":fmt.sar(totals.cpa)}              color="#f43f5e"                     icon="🎯"/>
            <KPICard label="Impressions" value={campLoad?"—":fmt.compact(totals.impressions)}  color="#6366f1"                     icon="👁"/>
            <KPICard label="Swipes"      value={campLoad?"—":fmt.compact(totals.swipes||totals.clicks)} color="#8b5cf6"            icon="👆"/>
            <KPICard label="CTR"         value={campLoad?"—":fmt.pct(totals.ctr)}              color={ctrColor(totals.ctr)}        icon="📊"/>
            <KPICard label="CPM (SAR)"   value={campLoad?"—":fmt.sar(totals.cpm)}              color="#22c55e"                     icon="📡"/>
            <KPICard label="Hook Rate"   value={campLoad?"—":(totals.hook_rate>0?fmt.pct(totals.hook_rate):"—")} sub="25% video plays" color={hookColor(totals.hook_rate)} icon="🎬"/>
            <KPICard label="Completion"  value={campLoad?"—":(totals.completion_rate>0?fmt.pct(totals.completion_rate):"—")} sub="97% completion" color={holdColor(totals.completion_rate)} icon="⏱"/>
          </div>

          {n(totals.impressions)>0&&(
            <div className="dash-chart-card">
              <div className="dash-chart-head"><div><h2>Video Funnel</h2><p>Impressions → 25% → 75% → Completion → Swipe → Purchase</p></div></div>
              <div style={{display:"flex",alignItems:"flex-end",gap:8,height:90,padding:"0 8px"}}>
                {[
                  {l:"Impressions",v:n(totals.impressions),pct:100,c:"#6366f1"},
                  {l:"25% Played",v:n(totals.quartile_1||0),pct:n(totals.hook_rate),c:hookColor(totals.hook_rate)},
                  {l:"75% Played",v:n(totals.quartile_3||0),pct:divide_safe(totals.quartile_3,totals.impressions)*100,c:"#8b5cf6"},
                  {l:"Completed",v:n(totals.view_completion||0),pct:n(totals.completion_rate||0),c:holdColor(totals.completion_rate)},
                  {l:"Swipes",v:n(totals.swipes),pct:n(totals.ctr),c:"#f59e0b"},
                  {l:"Purchases",v:n(totals.purchases),pct:n(totals.purchases)/Math.max(n(totals.impressions),1)*100,c:"#06d6a0"},
                ].map((step,i)=>(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",gap:4,alignItems:"center"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"var(--text)",fontFamily:"'Space Grotesk',sans-serif"}}>{fmt.compact(step.v)}</div>
                    <div style={{width:"100%",height:Math.max(step.pct||0,2),background:step.c,borderRadius:"4px 4px 0 0",minHeight:4}}/>
                    <div style={{fontSize:9,color:"var(--muted)",textAlign:"center"}}>{step.l}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="dash-chart-card">
            <div className="dash-chart-head"><div><h2>Spend vs Revenue vs Swipes</h2><p>Top 8 campaigns (SAR)</p></div></div>
            <div className="dash-chart-box">
              {chartData.length===0?<div className="dash-empty"><h3>{campLoad?"⏳ Loading...":"No data"}</h3></div>:(
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barGap={3}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                    <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false}/>
                    <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false}/>
                    <Tooltip content={<ChartTip/>} cursor={{fill:"rgba(255,252,0,0.03)"}}/>
                    <Bar dataKey="spend"   name="Spend (SAR)"   fill={SNAP_YELLOW} radius={[5,5,0,0]}/>
                    <Bar dataKey="revenue" name="Revenue (SAR)" fill="#06d6a0"     radius={[5,5,0,0]}/>
                    <Bar dataKey="swipes"  name="Swipes"        fill="#8b5cf6"     radius={[5,5,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab==="campaigns"&&<SnapTable title="Campaigns" loading={campLoad}  rows={campRows}  showHook/>}
      {activeTab==="adsquads" &&<SnapTable title="Ad Squads" loading={squadLoad} rows={squadRows} showHook/>}
      {activeTab==="ads"      &&<SnapTable title="Ads"       loading={adLoad}    rows={adRows}    showHook/>}
      {activeTab==="creative" &&(adLoaded?<CreativeGallery rows={adRows}/>:<div className="dash-empty"><h3>{adLoad?"⏳ Loading ads...":"Switch to Ads tab first to load data."}</h3></div>)}
    </main>
  );
}

function divide_safe(a,b) { const x=n(a),y=n(b); return y?x/y:0; }
