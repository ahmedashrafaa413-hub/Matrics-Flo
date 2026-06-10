"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";

const SNAP_COLOR = "#FFFC00";
const SNAP_DARK  = "#E6E300";

const fmt = {
  money:   (v) => `$${Number(v||0).toFixed(2)}`,
  number:  (v) => Number(v||0).toLocaleString(),
  percent: (v) => `${Number(v||0).toFixed(2)}%`,
  x:       (v) => `${Number(v||0).toFixed(2)}x`,
  compact: (v) => { const n=Number(v||0); return n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}K`:n.toLocaleString(); },
};

const DATE_OPTIONS = [
  { value:"today",      label:"Today"        },
  { value:"yesterday",  label:"Yesterday"    },
  { value:"last_7d",    label:"Last 7 Days"  },
  { value:"last_30d",   label:"Last 30 Days" },
  { value:"this_month", label:"This Month"   },
  { value:"last_90d",   label:"Last 90 Days" },
  { value:"maximum",    label:"Maximum"      },
  { value:"custom",     label:"Custom Range" },
];

const TABS = [
  { key:"overview",   label:"Overview",   icon:"⬡" },
  { key:"campaigns",  label:"Campaigns",  icon:"◈" },
  { key:"adsquads",   label:"Ad Squads",  icon:"◫" },
  { key:"ads",        label:"Ads",        icon:"▣" },
];

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:"10px 14px" }}>
      <p style={{ color:"var(--muted)", fontSize:11, marginBottom:6 }}>{label}</p>
      {payload.map((p,i) => <p key={i} style={{ color:p.color, fontWeight:700, fontSize:12 }}>{p.name}: {p.value?.toLocaleString()}</p>)}
    </div>
  );
};

function StatusDot({ status }) {
  if (!status) return null;
  const st = status.toUpperCase();
  const cfg =
    st==="ACTIVE"  ? { color:"#06d6a0", label:"Active"  } :
    st==="PAUSED"  ? { color:"#f59e0b", label:"Paused"  } :
    st==="PENDING" ? { color:"#6366f1", label:"Pending" } :
                     { color:"#7b88b8", label:status     };
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 8px", borderRadius:999, fontSize:11, fontWeight:700, color:cfg.color, background:`${cfg.color}12`, border:`1px solid ${cfg.color}25`, whiteSpace:"nowrap" }}>
      <span style={{ width:5, height:5, borderRadius:"50%", background:cfg.color, flexShrink:0 }} />
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

export default function SnapchatPage() {
  const [accounts,      setAccounts]      = useState([]);
  const [accountId,     setAccountId]     = useState("");
  const [activeTab,     setActiveTab]     = useState("overview");
  const [datePreset,    setDatePreset]    = useState("last_30d");
  const [customSince,   setCustomSince]   = useState("");
  const [customUntil,   setCustomUntil]   = useState("");
  const [showCustom,    setShowCustom]    = useState(false);

  const [campRows,      setCampRows]      = useState([]);
  const [campSummary,   setCampSummary]   = useState(null);
  const [campLoading,   setCampLoading]   = useState(false);

  const [adsquadRows,   setAdsquadRows]   = useState([]);
  const [adsquadLoaded, setAdsquadLoaded] = useState(false);
  const [adsquadLoading,setAdsquadLoading]= useState(false);

  const [adRows,        setAdRows]        = useState([]);
  const [adLoaded,      setAdLoaded]      = useState(false);
  const [adLoading,     setAdLoading]     = useState(false);

  const [connected,     setConnected]     = useState(true);
  const [error,         setError]         = useState("");

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { if (accountId) { resetData(); loadCampaigns(); } }, [accountId, datePreset, customSince, customUntil]);
  useEffect(() => {
    if (accountId && activeTab === "adsquads" && !adsquadLoaded) loadAdsquads();
    if (accountId && activeTab === "ads" && !adLoaded) loadAds();
  }, [activeTab, accountId]);

  function resetData() {
    setCampRows([]); setCampSummary(null);
    setAdsquadRows([]); setAdsquadLoaded(false);
    setAdRows([]); setAdLoaded(false);
    setError("");
  }

  function buildDateParam() {
    if (datePreset === "custom" && customSince && customUntil)
      return `since=${customSince}&until=${customUntil}`;
    return `date_preset=${datePreset}`;
  }

  async function loadAccounts() {
    try {
      const data = await apiGet("/api/snapchat/accounts");
      if (!data.success) { setConnected(false); return; }
      const list = data.data || [];
      setAccounts(list);
      const saved = getSetting("primary_snapchat_account", "");
      const sel   = saved || list[0]?.id || "";
      setAccountId(sel);
      if (sel) saveSetting("primary_snapchat_account", sel);
      setConnected(true);
    } catch { setConnected(false); }
  }

  async function loadCampaigns() {
    if (!accountId) return;
    setCampLoading(true); setError("");
    try {
      const data = await apiGet(`/api/snapchat/insights?account_id=${accountId}&level=campaign&${buildDateParam()}`);
      setCampRows(data.data || []); setCampSummary(data.summary || null);
    } catch(e) { setError(e.message); }
    finally { setCampLoading(false); }
  }

  async function loadAdsquads() {
    if (!accountId) return;
    setAdsquadLoading(true);
    try {
      const data = await apiGet(`/api/snapchat/insights?account_id=${accountId}&level=adsquad&${buildDateParam()}`);
      setAdsquadRows(data.data || []); setAdsquadLoaded(true);
    } catch(e) { setError(e.message); }
    finally { setAdsquadLoading(false); }
  }

  async function loadAds() {
    if (!accountId) return;
    setAdLoading(true);
    try {
      const data = await apiGet(`/api/snapchat/insights?account_id=${accountId}&level=ad&${buildDateParam()}`);
      setAdRows(data.data || []); setAdLoaded(true);
    } catch(e) { setError(e.message); }
    finally { setAdLoading(false); }
  }

  function refresh() {
    resetData(); loadCampaigns();
    if (activeTab === "adsquads") { setAdsquadLoaded(false); loadAdsquads(); }
    if (activeTab === "ads")      { setAdLoaded(false);      loadAds(); }
  }

  const totals     = campSummary || {};
  const chartData  = useMemo(() => campRows.slice(0,8).map(r => ({
    name: (r.name||"Unknown").slice(0,14),
    spend: +Number(r.spend||0).toFixed(2),
    revenue: +Number(r.purchase_value||0).toFixed(2),
  })), [campRows]);

  const ctrColor = (v) => Number(v||0)>=1?"var(--accent)":Number(v||0)>=0.5?"var(--gold)":"var(--red)";

  // ── Not connected ──
  if (!connected) return (
    <main style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:300, gap:16 }}>
      <div style={{ width:52, height:52, borderRadius:14, background:"rgba(255,252,0,0.1)", border:"1px solid rgba(255,252,0,0.25)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:26 }}>👻</div>
      <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, fontWeight:700, color:"var(--text)" }}>Snapchat not connected</h1>
      <p style={{ color:"var(--muted)", fontSize:14, textAlign:"center" }}>Connect your Snapchat Ads account to view campaigns, ad squads, and creative performance.</p>
      <a href="/api/snapchat/auth" style={{ background:"linear-gradient(135deg,#FFFC00,#E6E300)", color:"#000", padding:"11px 24px", borderRadius:"var(--radius-md)", fontWeight:700, fontSize:13, textDecoration:"none" }}>
        Connect Snapchat →
      </a>
    </main>
  );

  return (
    <main style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* ── Top Bar ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"rgba(255,252,0,0.12)", border:"1px solid rgba(255,252,0,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>👻</div>
          <div>
            <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:20, fontWeight:700, color:"var(--text)", letterSpacing:"-0.3px" }}>Snapchat Ads</h1>
            <p style={{ fontSize:12, color:"var(--muted)" }}>{accounts.find(a=>a.id===accountId)?.name || "No account selected"}</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          {accounts.length > 0 && (
            <select value={accountId} onChange={e=>{ setAccountId(e.target.value); saveSetting("primary_snapchat_account",e.target.value); }} style={{ background:"var(--card)", color:"var(--text)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"8px 12px", fontSize:12, fontWeight:600, fontFamily:"inherit", outline:"none", cursor:"pointer" }}>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name} — {a.currency}</option>)}
            </select>
          )}
          <select value={datePreset} onChange={e=>{ const v=e.target.value; setDatePreset(v); setShowCustom(v==="custom"); if(v!=="custom"){setCustomSince("");setCustomUntil("");} }} style={{ background:"var(--card)", color:"var(--text)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"8px 12px", fontSize:12, fontWeight:600, fontFamily:"inherit", outline:"none", cursor:"pointer" }}>
            {DATE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="dash-refresh" onClick={refresh} disabled={campLoading}>{campLoading?"⏳":"↺"} Refresh</button>
        </div>
      </div>

      {/* Custom date picker */}
      {showCustom && (
        <div style={{ background:"var(--card)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-lg)", padding:"14px 16px", display:"flex", alignItems:"flex-end", gap:10, flexWrap:"wrap" }}>
          {[{label:"From",val:customSince,set:setCustomSince,max:customUntil},{label:"To",val:customUntil,set:setCustomUntil,min:customSince}].map(f=>(
            <div key={f.label}>
              <div style={{ fontSize:10, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:5 }}>{f.label}</div>
              <input type="date" value={f.val} min={f.min} max={f.max} onChange={e=>f.set(e.target.value)} style={{ background:"var(--glass)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"8px 12px", color:"var(--text)", fontSize:13, fontFamily:"inherit", outline:"none", colorScheme:"dark" }} />
            </div>
          ))}
          <button disabled={!customSince||!customUntil} onClick={()=>{ resetData(); loadCampaigns(); }} style={{ background:customSince&&customUntil?"linear-gradient(135deg,var(--primary),#4f46e5)":"var(--glass2)", color:customSince&&customUntil?"#fff":"var(--muted)", border:"none", padding:"9px 16px", borderRadius:"var(--radius-md)", fontSize:12, fontWeight:700, cursor:customSince&&customUntil?"pointer":"not-allowed", fontFamily:"inherit" }}>Apply ↗</button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display:"flex", gap:4, background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:4 }}>
        {TABS.map(tab=>(
          <button key={tab.key} onClick={()=>setActiveTab(tab.key)} style={{ flex:1, padding:"8px 12px", borderRadius:"var(--radius-md)", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:activeTab===tab.key?700:500, display:"flex", alignItems:"center", justifyContent:"center", gap:5, transition:"all 0.15s", background:activeTab===tab.key?"var(--card-2)":"transparent", color:activeTab===tab.key?"var(--text)":"var(--muted)", borderBottom:activeTab===tab.key?"2px solid #FFFC00":"2px solid transparent" }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="dash-message error">⚠ {error}</div>}

      {/* ══ OVERVIEW ══ */}
      {activeTab==="overview" && (
        <>
          <div className="dash-kpi-grid">
            <KPICard label="Spend"       value={campLoading?"—":fmt.money(totals.spend)}          color={SNAP_DARK} icon="💰" />
            <KPICard label="Revenue"     value={campLoading?"—":fmt.money(totals.purchase_value)} color="#06d6a0"   icon="💵" />
            <KPICard label="ROAS"        value={campLoading?"—":fmt.x(totals.roas)}               color="#06d6a0"   icon="📈" />
            <KPICard label="Purchases"   value={campLoading?"—":fmt.number(totals.purchases)}     color="#f59e0b"   icon="🛒" />
            <KPICard label="Impressions" value={campLoading?"—":fmt.compact(totals.impressions)}  color="#6366f1"   icon="👁" />
            <KPICard label="Swipes (CTR)"value={campLoading?"—":fmt.percent(totals.ctr)}          color="#8b5cf6"   icon="👆" />
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:14 }}>
            <div className="dash-chart-card">
              <div className="dash-chart-head"><div><h2>Revenue vs Spend</h2><p>Top campaigns</p></div></div>
              <div className="dash-chart-box">
                {chartData.length===0 ? <div className="dash-empty"><h3>{campLoading?"⏳ Loading...":"No data"}</h3></div> :
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barGap={3}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill:"rgba(255,252,0,0.04)" }} />
                    <Bar dataKey="revenue" name="Revenue ($)" fill="#06d6a0" radius={[5,5,0,0]} />
                    <Bar dataKey="spend"   name="Spend ($)"   fill={SNAP_DARK} radius={[5,5,0,0]} />
                  </BarChart>
                </ResponsiveContainer>}
              </div>
            </div>

            <div className="dash-chart-card">
              <div className="dash-chart-head"><div><h2>Snap Metrics</h2><p>Platform specific</p></div></div>
              <div style={{ display:"flex", flexDirection:"column", gap:10, marginTop:4 }}>
                {[
                  { label:"Total Impressions", val:fmt.compact(totals.impressions) },
                  { label:"Total Swipes",      val:fmt.compact(totals.clicks)      },
                  { label:"Total Purchases",   val:fmt.number(totals.purchases)    },
                  { label:"Avg ROAS",          val:fmt.x(totals.roas)              },
                  { label:"Avg CPA",           val:fmt.money(totals.cpa)           },
                ].map(m=>(
                  <div key={m.label} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid var(--border)" }}>
                    <span style={{ fontSize:12, color:"var(--muted)" }}>{m.label}</span>
                    <span style={{ fontSize:13, fontWeight:700, color:"var(--text)" }}>{campLoading?"—":m.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══ CAMPAIGNS ══ */}
      {activeTab==="campaigns" && (
        <div className="dash-table-card">
          <div className="dash-table-head"><div><h2>Campaigns</h2><p>{campLoading?"Loading...":campRows.length+" campaigns"}</p></div></div>
          {campLoading ? <div className="dash-empty"><h3>⏳ Loading...</h3></div> :
          campRows.length===0 ? <div className="dash-empty"><h3>No campaigns found</h3></div> :
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead><tr><th>Campaign</th><th>Status</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>Purchases</th><th>Impressions</th><th>Swipes</th><th>CTR</th></tr></thead>
              <tbody>
                {campRows.map((row,i)=>(
                  <tr key={i}>
                    <td className="dash-name-cell">{row.name}</td>
                    <td><StatusDot status={row.status} /></td>
                    <td>{fmt.money(row.spend)}</td>
                    <td>{fmt.money(row.purchase_value)}</td>
                    <td style={{ color:Number(row.roas||0)>=2?"var(--accent)":Number(row.roas||0)>=1?"var(--gold)":"var(--red)", fontWeight:700 }}>{fmt.x(row.roas)}</td>
                    <td>{fmt.number(row.purchases)}</td>
                    <td>{fmt.compact(row.impressions)}</td>
                    <td>{fmt.compact(row.swipes)}</td>
                    <td style={{ color:ctrColor(row.ctr), fontWeight:700 }}>{fmt.percent(row.ctr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}

      {/* ══ AD SQUADS ══ */}
      {activeTab==="adsquads" && (
        <div className="dash-table-card">
          <div className="dash-table-head"><div><h2>Ad Squads</h2><p>{adsquadLoading?"Loading...":adsquadRows.length+" ad squads"}</p></div></div>
          {adsquadLoading ? <div className="dash-empty"><h3>⏳ Loading...</h3></div> :
          adsquadRows.length===0 ? <div className="dash-empty"><h3>No ad squads found</h3></div> :
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead><tr><th>Ad Squad</th><th>Campaign</th><th>Status</th><th>Spend</th><th>ROAS</th><th>Purchases</th><th>Swipes</th><th>CTR</th><th>Freq.</th></tr></thead>
              <tbody>
                {adsquadRows.map((row,i)=>(
                  <tr key={i}>
                    <td className="dash-name-cell">{row.name}</td>
                    <td style={{ color:"var(--muted)", fontSize:12 }}>{row.campaign_name}</td>
                    <td><StatusDot status={row.status} /></td>
                    <td>{fmt.money(row.spend)}</td>
                    <td style={{ color:Number(row.roas||0)>=2?"var(--accent)":Number(row.roas||0)>=1?"var(--gold)":"var(--red)", fontWeight:700 }}>{fmt.x(row.roas)}</td>
                    <td>{fmt.number(row.purchases)}</td>
                    <td>{fmt.compact(row.swipes)}</td>
                    <td style={{ color:ctrColor(row.ctr), fontWeight:700 }}>{fmt.percent(row.ctr)}</td>
                    <td style={{ color:Number(row.frequency||0)>=3.5?"var(--red)":Number(row.frequency||0)>=3?"var(--gold)":"var(--text-2)" }}>{Number(row.frequency||0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}

      {/* ══ ADS ══ */}
      {activeTab==="ads" && (
        <div className="dash-table-card">
          <div className="dash-table-head"><div><h2>Ads</h2><p>{adLoading?"Loading...":adRows.length+" ads"}</p></div></div>
          {adLoading ? <div className="dash-empty"><h3>⏳ Loading...</h3></div> :
          adRows.length===0 ? <div className="dash-empty"><h3>No ads found</h3></div> :
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead><tr><th>Ad</th><th>Status</th><th>Spend</th><th>ROAS</th><th>Purchases</th><th>Swipes</th><th>CTR</th><th>Hook</th><th>Hold</th><th>Completion</th></tr></thead>
              <tbody>
                {adRows.map((row,i)=>(
                  <tr key={i}>
                    <td className="dash-name-cell">{row.name}</td>
                    <td><StatusDot status={row.status} /></td>
                    <td>{fmt.money(row.spend)}</td>
                    <td style={{ color:Number(row.roas||0)>=2?"var(--accent)":Number(row.roas||0)>=1?"var(--gold)":"var(--red)", fontWeight:700 }}>{fmt.x(row.roas)}</td>
                    <td>{fmt.number(row.purchases)}</td>
                    <td>{fmt.compact(row.swipes)}</td>
                    <td style={{ color:ctrColor(row.ctr), fontWeight:700 }}>{fmt.percent(row.ctr)}</td>
                    <td style={{ color:Number(row.hook_rate||0)>=25?"var(--accent)":"var(--text-2)" }}>{Number(row.hook_rate||0)>0?fmt.percent(row.hook_rate):"—"}</td>
                    <td style={{ color:Number(row.hold_rate||0)>=40?"var(--accent)":"var(--text-2)" }}>{Number(row.hold_rate||0)>0?fmt.percent(row.hold_rate):"—"}</td>
                    <td>{Number(row.completion_rate||0)>0?fmt.percent(row.completion_rate):"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </main>
  );
}
