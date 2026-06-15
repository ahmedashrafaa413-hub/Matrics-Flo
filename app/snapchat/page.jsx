"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import { rankCreatives, scoringSummary } from "../../lib/creativeScoring";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";

const SNAP_YELLOW = "#FFFC00";
const SNAP_DARK   = "#E6E300";

const fmt = {
  money:   (v) => `$${Number(v||0).toFixed(2)}`,
  number:  (v) => Number(v||0).toLocaleString(),
  percent: (v) => `${Number(v||0).toFixed(2)}%`,
  x:       (v) => `${Number(v||0).toFixed(2)}x`,
  compact: (v) => {
    const n = Number(v||0);
    if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
    return n.toLocaleString();
  }
};

const DATE_OPTIONS = [
  { value:"today",      label:"Today"       },
  { value:"yesterday",  label:"Yesterday"   },
  { value:"last_7d",    label:"Last 7 Days" },
  { value:"last_30d",   label:"Last 30 Days"},
  { value:"this_month", label:"This Month"  },
  { value:"last_90d",   label:"Last 90 Days"},
  { value:"maximum",    label:"Maximum"     },
];

const TABS = [
  { key:"overview",  label:"Overview",  icon:"⬡" },
  { key:"campaigns", label:"Campaigns", icon:"◈" },
  { key:"adsquads",  label:"Ad Squads", icon:"◫" },
  { key:"ads",       label:"Ads",       icon:"▣" },
  { key:"creative",  label:"Creative",  icon:"✦" },
];

// ── Color helpers ──────────────────────────────────────────────────────────────
const roasColor  = (v) => Number(v||0)>=3?"#06d6a0":Number(v||0)>=1?"#f59e0b":"#f43f5e";
const ctrColor   = (v) => Number(v||0)>=1?"#06d6a0":Number(v||0)>=0.5?"#f59e0b":"#f43f5e";
const hookColor  = (v) => Number(v||0)>=25?"#06d6a0":Number(v||0)>=15?"#f59e0b":"#f43f5e";
const holdColor  = (v) => Number(v||0)>=40?"#06d6a0":Number(v||0)>=25?"#f59e0b":"#f43f5e";
const freqColor  = (v) => Number(v||0)>=4?"#f43f5e":Number(v||0)>=3?"#f59e0b":"var(--text-2)";

// ── Snap-specific creative diagnosis ──────────────────────────────────────────
function diagnoseSnapCreative(row) {
  const roas      = Number(row.roas        || 0);
  const purchases = Number(row.purchases   || 0);
  const hookRate  = Number(row.hook_rate   || 0);
  const holdRate  = Number(row.hold_rate   || 0);
  const ctr       = Number(row.ctr         || 0);
  const spend     = Number(row.spend       || 0);
  const swipes    = Number(row.swipes      || row.clicks || 0);
  const atc       = Number(row.add_to_cart || 0);
  const compRate  = Number(row.completion_rate || 0);

  if (roas >= 3 && purchases >= 3 && hookRate >= 25)
    return { badge:"🏆 Winner",         severity:"success", problem:"Driving profitable purchases with strong engagement.",         action:"Duplicate creative, test 2–3 variations, increase budget 15–20%." };
  if (hookRate > 0 && hookRate < 15)
    return { badge:"🎬 Hook Issue",      severity:"high",    problem:"First 3 seconds not stopping users from scrolling.",          action:"Test new opening — show result, problem, or bold claim in first 2s. Try UGC or before/after format." };
  if (hookRate >= 25 && holdRate > 0 && holdRate < 20)
    return { badge:"⏱ Hold Issue",      severity:"medium",  problem:"Hook gets attention but viewers drop early.",                  action:"Shorten video, improve pacing, show offer or proof before drop-off point." };
  if (hookRate >= 20 && holdRate >= 20 && ctr < 0.5)
    return { badge:"💬 Swipe Issue",    severity:"medium",  problem:"Users watch but don't swipe up.",                             action:"Test stronger CTA text, clearer offer, urgency, or discount in final seconds." };
  if (hookRate >= 15 && compRate > 0 && compRate < 30)
    return { badge:"📉 Completion Low", severity:"medium",  problem:"Video not holding viewers to end — CTA may be missed.",       action:"Move CTA earlier, create shorter 6–10s version, test hook-to-offer format." };
  if (atc > 0 && purchases > 0 && purchases / atc < 0.15)
    return { badge:"🛒 Checkout Drop",  severity:"medium",  problem:"Users add to cart but don't complete purchase.",               action:"Review checkout flow, payment options, shipping cost, and add urgency." };
  if (spend > 30 && roas < 0.5 && purchases === 0)
    return { badge:"🔴 Loser",          severity:"high",    problem:"Spending without generating purchases.",                       action:"Pause. Review offer, creative angle, audience, and landing page before relaunch." };
  return   { badge:"⚪ Monitor",        severity:"neutral", problem:"No clear winner or critical issue detected.",                  action:"Keep monitoring until more spend and swipe volume are available." };
}

// ── Components ────────────────────────────────────────────────────────────────
const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:"10px 14px" }}>
      <p style={{ color:"var(--muted)", fontSize:11, marginBottom:6 }}>{label}</p>
      {payload.map((p,i) => <p key={i} style={{ color:p.color, fontWeight:700, fontSize:12 }}>{p.name}: {Number(p.value||0).toLocaleString()}</p>)}
    </div>
  );
};

function StatusDot({ status }) {
  const s = String(status||"").toUpperCase();
  const cfg =
    s==="ACTIVE"  ? { color:"#06d6a0", label:"Active"  } :
    s==="PAUSED"  ? { color:"#f59e0b", label:"Paused"  } :
    s==="PENDING" ? { color:"#6366f1", label:"Pending" } :
                    { color:"#6b7ba4", label:status||"—" };
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 8px", borderRadius:999, fontSize:11, fontWeight:700, color:cfg.color, background:`${cfg.color}12`, border:`1px solid ${cfg.color}25`, whiteSpace:"nowrap" }}>
      <span style={{ width:5, height:5, borderRadius:"50%", background:cfg.color, flexShrink:0, boxShadow:s==="ACTIVE"?`0 0 5px ${cfg.color}`:"none" }} />
      {cfg.label}
    </span>
  );
}

function KPICard({ label, value, color, icon }) {
  return (
    <div className="dash-kpi-card" style={{ position:"relative" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:color, borderRadius:"20px 20px 0 0" }} />
      <div className="dash-kpi-top">
        <span className="dash-kpi-label">{label}</span>
        <span className="dash-kpi-icon">{icon}</span>
      </div>
      <strong style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, color:"var(--text)" }}>{value}</strong>
    </div>
  );
}

function SectionLabel({ icon, title }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:12 }}>
      <span style={{ fontSize:14 }}>{icon}</span>
      <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"1px" }}>{title}</span>
    </div>
  );
}

function SignalBadge({ row }) {
  const roas=Number(row.roas||0), ctr=Number(row.ctr||0), swipes=Number(row.swipes||row.clicks||0);
  const cfg =
    (roas>=3&&ctr>=1)   ? { label:"Winner 🏆", color:"#f59e0b", bg:"rgba(245,158,11,0.1)"  } :
    (roas>=1.5||ctr>=1) ? { label:"Scale ↑",   color:"#06d6a0", bg:"rgba(6,214,160,0.1)"   } :
    (ctr<0.3)           ? { label:"Kill ✕",    color:"#f43f5e", bg:"rgba(244,63,94,0.1)"   } :
                          { label:"Watch",     color:"#f59e0b", bg:"rgba(245,158,11,0.08)" };
  return <span style={{ padding:"3px 9px", borderRadius:999, fontSize:11, fontWeight:700, color:cfg.color, background:cfg.bg, border:`1px solid ${cfg.color}25`, whiteSpace:"nowrap" }}>{cfg.label}</span>;
}

// ── Sortable Table Header ─────────────────────────────────────────────────────
function SortTh({ label, colKey, sortKey, sortDir, onSort }) {
  const active = sortKey === colKey;
  return (
    <th onClick={() => onSort(colKey)} style={{ cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", color:active ? SNAP_YELLOW : undefined }}>
      {label} <span style={{ opacity:active?1:0.3, fontSize:10 }}>{active?(sortDir==="desc"?"▼":"▲"):"⇅"}</span>
    </th>
  );
}

// ── Sortable Snap Table ───────────────────────────────────────────────────────
function SnapTable({ title, loading, rows, nameKey = "name" }) {
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState("desc");

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d==="desc"?"asc":"desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a,b) => {
      const av = Number(a[sortKey]||0), bv = Number(b[sortKey]||0);
      return sortDir==="desc" ? bv-av : av-bv;
    });
  }, [rows, sortKey, sortDir]);

  const shProps = { sortKey, sortDir, onSort: handleSort };

  return (
    <div className="dash-table-card">
      <div className="dash-table-head">
        <div><h2>{title}</h2><p>{loading?"Loading...":`${rows.length} rows`}</p></div>
      </div>
      {loading ? <div className="dash-empty"><h3>⏳ Loading...</h3></div> :
       rows.length===0 ? <div className="dash-empty"><h3>No data found</h3></div> :
      <div className="dash-table-scroll">
        <table className="dash-data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <SortTh label="Spend"       colKey="spend"       {...shProps} />
              <SortTh label="Revenue"     colKey="revenue"     {...shProps} />
              <SortTh label="ROAS"        colKey="roas"        {...shProps} />
              <SortTh label="Purchases"   colKey="purchases"   {...shProps} />
              <SortTh label="CPA"         colKey="cpa"         {...shProps} />
              <SortTh label="Swipes"      colKey="swipes"      {...shProps} />
              <SortTh label="CTR"         colKey="ctr"         {...shProps} />
              <SortTh label="Impressions" colKey="impressions" {...shProps} />
              <SortTh label="Hook Rate"   colKey="hook_rate"   {...shProps} />
              <SortTh label="Hold Rate"   colKey="hold_rate"   {...shProps} />
              <SortTh label="Video Views" colKey="video_views" {...shProps} />
              <th>Signal</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row,i) => (
              <tr key={row.id||i}>
                <td className="dash-name-cell">{row[nameKey]||row.ad_name||row.adsquad_name||row.campaign_name||row.name||"Unknown"}</td>
                <td><StatusDot status={row.status}/></td>
                <td>{fmt.money(row.spend)}</td>
                <td>{fmt.money(row.revenue||row.purchase_value)}</td>
                <td style={{ color:roasColor(row.roas), fontWeight:700 }}>{fmt.x(row.roas)}</td>
                <td>{fmt.number(row.purchases)}</td>
                <td>{fmt.money(row.cpa)}</td>
                <td>{fmt.compact(row.swipes||row.clicks)}</td>
                <td style={{ color:ctrColor(row.ctr), fontWeight:700 }}>{fmt.percent(row.ctr)}</td>
                <td>{fmt.compact(row.impressions)}</td>
                <td style={{ color:hookColor(row.hook_rate), fontWeight:700 }}>{row.hook_rate>0?fmt.percent(row.hook_rate):"—"}</td>
                <td style={{ color:holdColor(row.hold_rate), fontWeight:700 }}>{row.hold_rate>0?fmt.percent(row.hold_rate):"—"}</td>
                <td>{fmt.compact(row.video_views)}</td>
                <td><SignalBadge row={row}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SnapchatPage() {
  const [activeTab,      setActiveTab]      = useState("overview");
  const [accounts,       setAccounts]       = useState([]);
  const [accountId,      setAccountId]      = useState("");
  const [datePreset,     setDatePreset]     = useState("last_30d");
  const [creativeFilter, setCreativeFilter] = useState("all");

  const [campRows,     setCampRows]     = useState([]);
  const [campSummary,  setCampSummary]  = useState(null);
  const [campLoading,  setCampLoading]  = useState(false);

  const [adsquadRows,    setAdsquadRows]    = useState([]);
  const [adsquadLoaded,  setAdsquadLoaded]  = useState(false);
  const [adsquadLoading, setAdsquadLoading] = useState(false);

  const [adRows,    setAdRows]    = useState([]);
  const [adLoaded,  setAdLoaded]  = useState(false);
  const [adLoading, setAdLoading] = useState(false);

  const [connected, setConnected] = useState(true);
  const [error,     setError]     = useState("");

  const isLoading = campLoading || adsquadLoading || adLoading;

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => {
    if (!accountId) return;
    resetData();
    loadCampaigns(accountId);
  }, [accountId, datePreset]);
  useEffect(() => {
    if (!accountId) return;
    if ((activeTab==="adsquads") && !adsquadLoaded && !adsquadLoading) loadAdsquads(accountId);
    if ((activeTab==="ads"||activeTab==="creative") && !adLoaded && !adLoading) loadAds(accountId);
  }, [activeTab, accountId, adsquadLoaded, adLoaded]);

  function resetData() {
    setCampRows([]); setCampSummary(null);
    setAdsquadRows([]); setAdsquadLoaded(false);
    setAdRows([]); setAdLoaded(false);
    setError("");
  }

  function buildDateParam() { return `date_preset=${datePreset}`; }

  async function loadAccounts() {
    try {
      const data = await apiGet("/api/snapchat/accounts");
      if (!data.success) { setConnected(false); return; }
      const list = data.data || [];
      setAccounts(list);
      const saved = getSetting("primary_snapchat_account","");
      const sel = list.find(a=>a.id===saved)?.id || list[0]?.id || "";
      setAccountId(sel);
      if (sel) saveSetting("primary_snapchat_account", sel);
      setConnected(true);
    } catch { setConnected(false); }
  }

  async function loadCampaigns(acc=accountId) {
    if (!acc||campLoading) return;
    setCampLoading(true); setError("");
    try {
      const data = await apiGet(`/api/snapchat/insights?account_id=${acc}&level=campaign&${buildDateParam()}&active_only=1`);
      setCampRows(data.data||[]); setCampSummary(data.summary||null);
    } catch(e) { setError(e.message||"Failed to load campaigns"); }
    finally { setCampLoading(false); }
  }

  async function loadAdsquads(acc=accountId) {
    if (!acc||adsquadLoading) return;
    setAdsquadLoading(true); setError("");
    try {
      const data = await apiGet(`/api/snapchat/insights?account_id=${acc}&level=adsquad&${buildDateParam()}&active_only=1`);
      setAdsquadRows(data.data||[]); setAdsquadLoaded(true);
    } catch(e) { setError(e.message||"Failed to load ad squads"); }
    finally { setAdsquadLoading(false); }
  }

  async function loadAds(acc=accountId) {
    if (!acc||adLoading) return;
    setAdLoading(true); setError("");
    try {
      const data = await apiGet(`/api/snapchat/insights?account_id=${acc}&level=ad&${buildDateParam()}&active_only=1`);
      setAdRows(data.data||[]); setAdLoaded(true);
    } catch(e) { setError(e.message||"Failed to load ads"); }
    finally { setAdLoading(false); }
  }

  function refresh() {
    resetData();
    loadCampaigns(accountId);
    if (activeTab==="adsquads") { setAdsquadLoaded(false); loadAdsquads(accountId); }
    if (activeTab==="ads"||activeTab==="creative") { setAdLoaded(false); loadAds(accountId); }
  }

  // Computed
  const totals       = campSummary || {};
  const rankedAds    = useMemo(() => rankCreatives(adRows, "ad_name"), [adRows]);
  const adsSummary   = useMemo(() => scoringSummary(rankedAds), [rankedAds]);

  const chartData = useMemo(() =>
    campRows.slice(0,8).map(r => ({
      name: (r.name||r.campaign_name||"Unknown").slice(0,14),
      spend:   Number(r.spend||0),
      revenue: Number(r.revenue||0),
      swipes:  Number(r.swipes||r.clicks||0),
    })), [campRows]);

  if (!connected) {
    return (
      <main style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:300, gap:16 }}>
        <div style={{ width:52, height:52, borderRadius:14, background:"rgba(255,252,0,0.1)", border:"1px solid rgba(255,252,0,0.25)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>👻</div>
        <h1 style={{ color:"var(--text)" }}>Snapchat not connected</h1>
        <a href="/api/snapchat/auth" style={{ background:`linear-gradient(135deg,${SNAP_YELLOW},${SNAP_DARK})`, color:"#000", padding:"11px 24px", borderRadius:"var(--radius-md)", fontWeight:700, fontSize:13, textDecoration:"none" }}>
          Connect Snapchat →
        </a>
      </main>
    );
  }

  return (
    <main style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* ── Header ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"rgba(255,252,0,0.12)", border:"1px solid rgba(255,252,0,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>👻</div>
          <div>
            <h1 style={{ color:"var(--text)", fontSize:20 }}>Snapchat Ads</h1>
            <p style={{ fontSize:12, color:"var(--muted)" }}>{accounts.find(a=>a.id===accountId)?.name||"No account selected"}</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button className="dash-refresh" onClick={refresh} disabled={isLoading}>
            {isLoading?"Loading...":"↺ Refresh"}
          </button>
          <select value={datePreset} onChange={e=>setDatePreset(e.target.value)} disabled={isLoading}>
            {DATE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {accounts.length>0 && (
            <select value={accountId} onChange={e=>{ setAccountId(e.target.value); saveSetting("primary_snapchat_account",e.target.value); }} disabled={isLoading}>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name} — {a.currency}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display:"flex", gap:4, background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:4 }}>
        {TABS.map(tab=>(
          <button key={tab.key} onClick={()=>setActiveTab(tab.key)} style={{
            flex:1, padding:"8px 12px", borderRadius:"var(--radius-md)", border:"none", cursor:"pointer",
            fontFamily:"inherit", fontSize:12, fontWeight:activeTab===tab.key?700:500,
            background: activeTab===tab.key?"var(--card-2)":"transparent",
            color:      activeTab===tab.key?"var(--text)":"var(--muted)",
            borderBottom: activeTab===tab.key?`2px solid ${SNAP_YELLOW}`:"2px solid transparent"
          }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="dash-message error">⚠ {error}</div>}

      {/* ══ OVERVIEW TAB ══ */}
      {activeTab==="overview" && (
        <>
          <SectionLabel icon="📊" title="Account Overview" />
          <div className="dash-kpi-grid">
            <KPICard label="Spend"        value={campLoading?"—":fmt.money(totals.spend)}                        color={SNAP_DARK}  icon="💰" />
            <KPICard label="Revenue"      value={campLoading?"—":fmt.money(totals.revenue)}                      color="#06d6a0"    icon="💵" />
            <KPICard label="ROAS"         value={campLoading?"—":fmt.x(totals.roas)}                            color={roasColor(totals.roas)} icon="📈" />
            <KPICard label="Purchases"    value={campLoading?"—":fmt.number(totals.purchases)}                   color="#22c55e"    icon="🛒" />
            <KPICard label="CPA"          value={campLoading?"—":fmt.money(totals.cpa)}                          color="#f59e0b"    icon="🎯" />
            <KPICard label="Swipes"       value={campLoading?"—":fmt.compact(totals.swipes||totals.clicks)}      color="#8b5cf6"    icon="👆" />
            <KPICard label="CTR"          value={campLoading?"—":fmt.percent(totals.ctr)}                        color="#06d6a0"    icon="📊" />
            <KPICard label="Impressions"  value={campLoading?"—":fmt.compact(totals.impressions)}                color="#6366f1"    icon="👁" />
            <KPICard label="Video Views"  value={campLoading?"—":fmt.compact(totals.video_views)}                color="#38bdf8"    icon="🎥" />
            <KPICard label="Hook Rate"    value={campLoading?"—":totals.hook_rate>0?fmt.percent(totals.hook_rate):"—"} color={hookColor(totals.hook_rate)} icon="🎣" />
            <KPICard label="Hold Rate"    value={campLoading?"—":totals.hold_rate>0?fmt.percent(totals.hold_rate):"—"} color={holdColor(totals.hold_rate)} icon="⏱" />
            <KPICard label="Completion"   value={campLoading?"—":totals.completion_rate>0?fmt.percent(totals.completion_rate):"—"} color="#a78bfa" icon="✅" />
          </div>

          {/* Chart + Funnel */}
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:14 }}>
            <div className="dash-chart-card">
              <div className="dash-chart-head"><div><h2>Revenue vs Spend vs Swipes</h2><p>Top campaigns</p></div></div>
              <div className="dash-chart-box">
                {chartData.length===0
                  ? <div className="dash-empty"><h3>{campLoading?"⏳ Loading...":"No data"}</h3></div>
                  : <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} barGap={3}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                        <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false}/>
                        <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false}/>
                        <Tooltip content={<ChartTip/>}/>
                        <Bar dataKey="revenue" name="Revenue" fill="#06d6a0"  radius={[5,5,0,0]}/>
                        <Bar dataKey="spend"   name="Spend"   fill={SNAP_DARK} radius={[5,5,0,0]}/>
                        <Bar dataKey="swipes"  name="Swipes"  fill="#8b5cf6"  radius={[5,5,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                }
              </div>
            </div>

            {/* Snap Video Funnel */}
            <div className="dash-chart-card">
              <div className="dash-chart-head"><div><h2>Video Funnel</h2></div></div>
              {[
                { label:"Impressions",   val:fmt.compact(totals.impressions),  rate:null },
                { label:"Video Views",   val:fmt.compact(totals.video_views),  rate:totals.hook_rate>0?`Hook ${fmt.percent(totals.hook_rate)}`:null, warn:Number(totals.hook_rate||0)>0&&Number(totals.hook_rate||0)<15 },
                { label:"15s Views",     val:fmt.compact(totals.video_views_15s||0), rate:totals.hold_rate>0?`Hold ${fmt.percent(totals.hold_rate)}`:null, warn:Number(totals.hold_rate||0)>0&&Number(totals.hold_rate||0)<25 },
                { label:"Swipe Ups",     val:fmt.compact(totals.swipes||totals.clicks), rate:`CTR ${fmt.percent(totals.ctr)}`, warn:Number(totals.ctr||0)<0.5 },
                { label:"Purchases",     val:fmt.compact(totals.purchases),    rate:null },
              ].map((step,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderBottom:i<4?"1px solid var(--border)":"none" }}>
                  <div style={{ width:22, height:22, borderRadius:6, background:"var(--glass-2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"var(--muted)", flexShrink:0 }}>{i+1}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:10, color:"var(--muted)", marginBottom:1 }}>{step.label}</div>
                    <div style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>{campLoading?"—":step.val}</div>
                  </div>
                  {step.rate && <span style={{ fontSize:10, fontWeight:700, color:step.warn?"#f43f5e":SNAP_YELLOW, whiteSpace:"nowrap" }}>{step.rate}{step.warn?" ⚠":""}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Creative Snapshot */}
          {adLoaded && rankedAds.length>0 && (
            <>
              <SectionLabel icon="✦" title="Creative Snapshot" />
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                {rankedAds.slice(0,4).map((row,i) => {
                  const s=row._scoring;
                  const bc=s.score>=75?"#f59e0b":s.score>=55?"#06d6a0":s.score>=35?"#6366f1":"#f43f5e";
                  return (
                    <div key={i} style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:12, display:"flex", flexDirection:"column", gap:8 }}>
                      <div style={{ height:44, background:"var(--glass)", borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"var(--muted-2)" }}>👻</div>
                      <div style={{ fontSize:11, fontWeight:700, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row._name}</div>
                      <span style={{ display:"inline-flex", padding:"2px 8px", borderRadius:999, fontSize:10, fontWeight:700, color:s.decisionColor, background:s.decisionBg, border:`1px solid ${s.decisionColor}25`, width:"fit-content" }}>{s.decision}</span>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <div style={{ flex:1, height:3, background:"var(--border)", borderRadius:2, overflow:"hidden" }}><div style={{ height:"100%", width:`${s.score}%`, background:bc, borderRadius:2 }}/></div>
                        <span style={{ fontSize:10, fontWeight:700, color:bc }}>{s.score}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ══ CAMPAIGNS TAB ══ */}
      {activeTab==="campaigns" && (
        <SnapTable title="Campaigns" loading={campLoading} rows={campRows} nameKey="campaign_name"/>
      )}

      {/* ══ AD SQUADS TAB ══ */}
      {activeTab==="adsquads" && (
        <SnapTable title="Ad Squads" loading={adsquadLoading} rows={adsquadRows} nameKey="adsquad_name"/>
      )}

      {/* ══ ADS TAB ══ */}
      {activeTab==="ads" && (
        <>
          {!adLoaded && <div className="dash-empty"><h3>{adLoading?"⏳ Loading ads...":"Ads load when you open this tab."}</h3></div>}
          {adLoaded && (
            <>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
                {[
                  { label:"Winners 🏆", count:adsSummary.winners.length,  color:"#f59e0b" },
                  { label:"Scale ↑",    count:adsSummary.scalable.length, color:"#06d6a0" },
                  { label:"Test 🧪",    count:adsSummary.tests.length,    color:"#6366f1" },
                  { label:"Kill ✕",     count:adsSummary.kills.length,    color:"#f43f5e" },
                ].map(item=>(
                  <div key={item.label} style={{ background:`${item.color}10`, border:`1px solid ${item.color}25`, borderRadius:"var(--radius-lg)", padding:"14px 16px" }}>
                    <div style={{ fontSize:11, fontWeight:700, color:item.color, textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:6 }}>{item.label}</div>
                    <strong style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:26, fontWeight:700, color:item.color }}>{item.count}</strong>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {rankedAds.map((row,i) => {
                  const s=row._scoring;
                  const bc=s.score>=75?"#f59e0b":s.score>=55?"#06d6a0":s.score>=35?"#6366f1":"#f43f5e";
                  return (
                    <div key={i} style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", padding:"14px 18px", display:"grid", gridTemplateColumns:"2fr 90px 70px 80px 80px 80px 80px 110px", gap:12, alignItems:"center" }}>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row._name}</div>
                        {s.diagnosis.primaryIssue && <div style={{ fontSize:11, color:"#f43f5e", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>⚠ {s.diagnosis.primaryIssue}</div>}
                        {!s.diagnosis.primaryIssue && s.diagnosis.primaryWin && <div style={{ fontSize:11, color:"#06d6a0", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>✓ {s.diagnosis.primaryWin}</div>}
                      </div>
                      <div><div style={{ fontSize:9, color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:3 }}>Status</div><StatusDot status={row.status}/></div>
                      {[
                        { label:"Score",   content:<div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ flex:1, height:5, background:"rgba(255,255,255,0.06)", borderRadius:3, overflow:"hidden" }}><div style={{ height:"100%", width:`${s.score}%`, background:bc, borderRadius:3 }}/></div><span style={{ fontSize:11, fontWeight:700, color:bc }}>{s.score}</span></div> },
                        { label:"Spend",   content:<div style={{ fontSize:12, fontWeight:600, color:"var(--text)" }}>{fmt.money(row.spend)}</div> },
                        { label:"ROAS",    content:<div style={{ fontSize:12, fontWeight:700, color:roasColor(row.roas) }}>{fmt.x(row.roas)}</div> },
                        { label:"Hook",    content:<div style={{ fontSize:12, fontWeight:600, color:hookColor(row.hook_rate) }}>{row.hook_rate>0?fmt.percent(row.hook_rate):"—"}</div> },
                        { label:"Hold",    content:<div style={{ fontSize:12, fontWeight:600, color:holdColor(row.hold_rate) }}>{row.hold_rate>0?fmt.percent(row.hold_rate):"—"}</div> },
                      ].map(col=>(
                        <div key={col.label}><div style={{ fontSize:9, color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:3 }}>{col.label}</div>{col.content}</div>
                      ))}
                      <span style={{ padding:"4px 10px", borderRadius:999, fontSize:11, fontWeight:700, color:s.decisionColor, background:s.decisionBg, border:`1px solid ${s.decisionColor}30`, whiteSpace:"nowrap" }}>{s.decision}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ══ CREATIVE GALLERY TAB ══ */}
      {activeTab==="creative" && (
        <>
          {!adLoaded && <div className="dash-empty"><h3>{adLoading?"⏳ Loading creative data...":"Creative data loads when you open this tab."}</h3></div>}
          {adLoaded && (() => {
            const SEVERITY_ORDER = { success:0, high:1, medium:2, neutral:3 };
            const diagnosed = adRows
              .map(row => ({ ...row, _diag: diagnoseSnapCreative(row) }))
              .sort((a,b) => {
                const so = SEVERITY_ORDER[a._diag.severity] - SEVERITY_ORDER[b._diag.severity];
                if (so!==0) return so;
                return Number(b.roas||0) - Number(a.roas||0) || Number(b.purchases||0) - Number(a.purchases||0) || Number(b.spend||0) - Number(a.spend||0);
              });

            const filtered = diagnosed.filter(row => {
              if (creativeFilter==="all")         return true;
              if (creativeFilter==="winners")     return row._diag.severity==="success";
              if (creativeFilter==="problems")    return row._diag.severity==="high";
              if (creativeFilter==="no_purchase") return Number(row.purchases||0)===0 && Number(row.spend||0)>5;
              if (creativeFilter==="hook_issue")  return Number(row.hook_rate||0)>0 && Number(row.hook_rate||0)<15;
              return true;
            });

            const totalSpend    = adRows.reduce((s,r)=>s+Number(r.spend||0),0);
            const totalPur      = adRows.reduce((s,r)=>s+Number(r.purchases||0),0);
            const totalRev      = adRows.reduce((s,r)=>s+Number(r.revenue||r.purchase_value||0),0);
            const avgROAS       = totalSpend ? totalRev/totalSpend : 0;
            const avgCPA        = totalPur   ? totalSpend/totalPur : 0;
            const winnersCount  = diagnosed.filter(r=>r._diag.severity==="success").length;
            const problemsCount = diagnosed.filter(r=>r._diag.severity==="high").length;
            const hookIssues    = diagnosed.filter(r=>Number(r.hook_rate||0)>0&&Number(r.hook_rate||0)<15).length;

            return (
              <>
                {/* Summary KPIs */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:10 }}>
                  {[
                    { label:"Total Spend",  val:fmt.money(totalSpend),  color:"#6366f1" },
                    { label:"Purchases",    val:fmt.number(totalPur),   color:"#f59e0b" },
                    { label:"Revenue",      val:fmt.money(totalRev),    color:"#06d6a0" },
                    { label:"Avg ROAS",     val:fmt.x(avgROAS),         color:"#06d6a0" },
                    { label:"Avg CPA",      val:fmt.money(avgCPA),      color:"#f43f5e" },
                    { label:"Winners 🏆",   val:winnersCount,           color:"#f59e0b" },
                    { label:"Problems 🔴",  val:problemsCount,          color:"#f43f5e" },
                  ].map(k=>(
                    <div key={k.label} className="dash-kpi-card" style={{ padding:"14px 16px", position:"relative" }}>
                      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:k.color, borderRadius:"20px 20px 0 0" }}/>
                      <div style={{ fontSize:9, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:8 }}>{k.label}</div>
                      <strong style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:700, color:k.color }}>{k.val}</strong>
                    </div>
                  ))}
                </div>

                {/* Filter Pills */}
                <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
                  {[
                    { key:"all",         label:`All (${diagnosed.length})`,          color:"var(--muted)" },
                    { key:"winners",     label:`🏆 Winners (${winnersCount})`,         color:"#f59e0b"      },
                    { key:"problems",    label:`🔴 Problems (${problemsCount})`,        color:"#f43f5e"      },
                    { key:"hook_issue",  label:`🎬 Hook Issue (${hookIssues})`,         color:"#8b5cf6"      },
                    { key:"no_purchase", label:`💸 No Purchase (${diagnosed.filter(r=>Number(r.purchases||0)===0&&Number(r.spend||0)>5).length})`, color:"#6366f1" },
                  ].map(f=>(
                    <button key={f.key} onClick={()=>setCreativeFilter(f.key)} style={{ padding:"6px 13px", borderRadius:999, fontSize:11, fontWeight:700, border:`1px solid ${creativeFilter===f.key?f.color:"var(--border)"}`, background:creativeFilter===f.key?`${f.color}15`:"transparent", color:creativeFilter===f.key?f.color:"var(--muted)", cursor:"pointer", fontFamily:"inherit" }}>{f.label}</button>
                  ))}
                </div>

                {/* Creative Gallery Grid */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
                  {filtered.map((row,i) => {
                    const diag = row._diag;
                    const sevColor =
                      diag.severity==="success" ? "#f59e0b" :
                      diag.severity==="high"    ? "#f43f5e" :
                      diag.severity==="medium"  ? "#f59e0b" : "var(--muted)";
                    const sevBg =
                      diag.severity==="success" ? "rgba(245,158,11,0.1)"  :
                      diag.severity==="high"    ? "rgba(244,63,94,0.1)"   :
                      diag.severity==="medium"  ? "rgba(245,158,11,0.08)" : "rgba(148,163,184,0.08)";

                    const isVideo = Number(row.hook_rate||0)>0||Number(row.video_views||0)>0;

                    return (
                      <div key={i} style={{ background:"var(--card)", border:`1px solid ${diag.severity==="success"?"rgba(245,158,11,0.3)":diag.severity==="high"?"rgba(244,63,94,0.2)":"var(--border)"}`, borderRadius:"var(--radius-xl)", overflow:"hidden", display:"flex", flexDirection:"column", transition:"transform 0.2s" }}
                        onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                        onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}
                      >
                        {/* Preview placeholder */}
                        <div style={{ height:120, background:`linear-gradient(135deg, rgba(255,252,0,0.06), rgba(139,92,246,0.08))`, position:"relative", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <span style={{ fontSize:32, opacity:0.3 }}>👻</span>
                          <div style={{ position:"absolute", top:8, right:8, padding:"3px 9px", borderRadius:999, fontSize:10, fontWeight:700, background:"rgba(0,0,0,0.7)", color:"#fff", backdropFilter:"blur(4px)" }}>
                            {isVideo?"🎬 Video":"🖼 Image"}
                          </div>
                          <div style={{ position:"absolute", top:8, left:8 }}><StatusDot status={row.status}/></div>
                        </div>

                        <div style={{ padding:"14px", display:"flex", flexDirection:"column", gap:10, flex:1 }}>
                          {/* Identity */}
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={row.ad_name}>{row.ad_name||"Unknown"}</div>
                            <div style={{ fontSize:10, color:"var(--muted)", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row.campaign_name||""}</div>
                            <div style={{ fontSize:10, color:"var(--muted-2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row.adsquad_name||""}</div>
                          </div>

                          {/* Core Metrics */}
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                            {[
                              { label:"Spend",     val:fmt.money(row.spend) },
                              { label:"Purchases", val:fmt.number(row.purchases) },
                              { label:"Revenue",   val:fmt.money(row.revenue||row.purchase_value) },
                              { label:"ROAS",      val:fmt.x(row.roas),    color:roasColor(row.roas) },
                              { label:"CPA",       val:fmt.money(row.cpa) },
                              { label:"CTR",       val:fmt.percent(row.ctr), color:ctrColor(row.ctr) },
                            ].map(m=>(
                              <div key={m.label} style={{ background:"var(--glass)", borderRadius:"var(--radius-sm)", padding:"7px 8px" }}>
                                <div style={{ fontSize:9, color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:2 }}>{m.label}</div>
                                <div style={{ fontSize:13, fontWeight:700, color:m.color||"var(--text)" }}>{m.val}</div>
                              </div>
                            ))}
                          </div>

                          {/* Video Metrics */}
                          {isVideo && (
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                              {[
                                { label:"Hook Rate",    val:fmt.percent(row.hook_rate),       color:hookColor(row.hook_rate) },
                                { label:"Hold Rate",    val:fmt.percent(row.hold_rate),       color:holdColor(row.hold_rate) },
                                { label:"Completion",   val:fmt.percent(row.completion_rate), color:"var(--text)" },
                              ].map(m=>(
                                <div key={m.label} style={{ background:"rgba(255,252,0,0.05)", border:"1px solid rgba(255,252,0,0.1)", borderRadius:"var(--radius-sm)", padding:"7px 8px" }}>
                                  <div style={{ fontSize:9, color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:2 }}>{m.label}</div>
                                  <div style={{ fontSize:13, fontWeight:700, color:m.color }}>{m.val}</div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Swipe Funnel */}
                          <div style={{ display:"flex", gap:4, fontSize:10, color:"var(--muted)", flexWrap:"wrap" }}>
                            {[
                              { label:"Views",   val:fmt.compact(row.video_views||0) },
                              { label:"Swipes",  val:fmt.compact(row.swipes||row.clicks||0) },
                              { label:"ATC",     val:fmt.compact(row.add_to_cart||0) },
                              { label:"Buy",     val:fmt.compact(row.purchases||0) },
                            ].map((f,fi)=>(
                              <span key={f.label} style={{ display:"flex", alignItems:"center", gap:3 }}>
                                {fi>0 && <span style={{ color:"var(--muted-2)" }}>›</span>}
                                <span style={{ color:"var(--muted-2)" }}>{f.label}</span>
                                <span style={{ color:"var(--text)", fontWeight:600 }}>{f.val}</span>
                              </span>
                            ))}
                          </div>

                          {/* Diagnosis */}
                          <div style={{ background:sevBg, border:`1px solid ${sevColor}25`, borderRadius:"var(--radius-md)", padding:"10px 12px" }}>
                            <div style={{ fontSize:11, fontWeight:700, color:sevColor, marginBottom:6 }}>{diag.badge}</div>
                            <div style={{ fontSize:11, color:"var(--text2)", marginBottom:4 }}><strong style={{ color:"var(--text)" }}>Problem:</strong> {diag.problem}</div>
                            <div style={{ fontSize:11, color:"var(--muted)" }}><strong>Action:</strong> {diag.action}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {filtered.length===0 && <div className="dash-empty"><h3>No ads match this filter</h3></div>}
              </>
            );
          })()}
        </>
      )}
    </main>
  );
}
