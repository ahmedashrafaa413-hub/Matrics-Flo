"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import { rankCreatives, scoringSummary } from "../../lib/creativeScoring";
import {
  ResponsiveContainer, BarChart, Bar,
  AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";

const fmt = {
  money:   (v) => `$${Number(v||0).toFixed(2)}`,
  number:  (v) => Number(v||0).toLocaleString(),
  percent: (v) => `${Number(v||0).toFixed(2)}%`,
  x:       (v) => `${Number(v||0).toFixed(2)}x`,
  compact: (v) => { const n=Number(v||0); return n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}K`:n.toLocaleString(); }
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

// ── Date Picker Component ──────────────────────────────────────────────────
function DateRangePicker({ since, until, onApply }) {
  const [from, setFrom] = useState(since || "");
  const [to,   setTo]   = useState(until || "");
  const today = new Date().toISOString().split("T")[0];

  return (
    <div style={{
      background: "var(--card)", border: "1px solid var(--border-2)",
      borderRadius: "var(--radius-lg)", padding: "14px 16px",
      display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap"
    }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 5 }}>From</div>
        <input
          type="date" value={from} max={to || today}
          onChange={e => setFrom(e.target.value)}
          style={{ background: "var(--glass)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-md)", padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", colorScheme: "dark" }}
        />
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 5 }}>To</div>
        <input
          type="date" value={to} min={from} max={today}
          onChange={e => setTo(e.target.value)}
          style={{ background: "var(--glass)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-md)", padding: "8px 12px", color: "var(--text)", fontSize: 13, fontFamily: "inherit", outline: "none", colorScheme: "dark" }}
        />
      </div>
      <button
        disabled={!from || !to}
        onClick={() => onApply(from, to)}
        style={{ background: from && to ? "linear-gradient(135deg,var(--primary),#4f46e5)" : "var(--glass2)", color: from && to ? "#fff" : "var(--muted)", border: "none", padding: "9px 16px", borderRadius: "var(--radius-md)", fontSize: 12, fontWeight: 700, cursor: from && to ? "pointer" : "not-allowed", fontFamily: "inherit" }}
      >
        Apply ↗
      </button>
    </div>
  );
}

// ── diagnoseCreative ───────────────────────────────────────────────────────
function diagnoseCreative(row) {
  const roas      = Number(row.roas       || 0);
  const purchases = Number(row.purchases  || 0);
  const hookRate  = Number(row.hook_rate  || 0);
  const holdRate  = Number(row.hold_rate  || 0);
  const frequency = Number(row.frequency  || 0);
  const ctr       = Number(row.ctr        || 0);
  const spend     = Number(row.spend      || 0);
  const addToCart = Number(row.add_to_cart|| 0);
  const lpv       = Number(row.landing_page_views || 0);
  const lpvRate   = Number(row.lpv_rate   || 0);

  if (roas >= 3 && purchases >= 3 && hookRate >= 30 && frequency < 4)
    return { label:"Winner Creative",     severity:"success", badge:"🏆 Winner",        problem:"This creative is driving profitable purchases.",                cause:"Strong hook, acceptable frequency, and strong business outcome.",                    action:"Duplicate, create 3 variations from same angle, increase budget 15–20%." };
  if (hookRate > 0 && hookRate < 20)
    return { label:"Creative Problem",    severity:"high",    badge:"🎬 Hook Issue",     problem:"The first seconds are not stopping users.",                    cause:"Weak opening, unclear promise, slow start, or poor scroll-stopper.",              action:"Test 3 new hooks. Show outcome or pain in first 2s. Try UGC, before/after, problem-first, or bold claim." };
  if (hookRate >= 30 && holdRate > 0 && holdRate < 10)
    return { label:"Hold Problem",        severity:"medium",  badge:"⏱ Hold Issue",     problem:"Hook gets attention but users drop quickly.",                  cause:"Middle of video is slow, unclear, or doesn't build enough interest.",            action:"Shorten video, improve pacing, show proof earlier, introduce offer before drop-off." };
  if (hookRate >= 25 && holdRate >= 10 && ctr < 1)
    return { label:"Offer / CTA Problem", severity:"medium",  badge:"💬 Offer Issue",   problem:"Users are watching but not clicking.",                         cause:"Offer, CTA, or value proposition is not compelling enough.",                     action:"Test stronger CTA, clearer offer, price angle, guarantee, urgency, or social proof." };
  if (frequency > 4 && ctr < 1)
    return { label:"Creative Fatigue",    severity:"medium",  badge:"🔁 Fatigue",       problem:"Audience may have seen this creative too many times.",          cause:"Frequency is high and CTR is weak.",                                             action:"Refresh creative, test new angles, exclude saturated audiences." };
  if (ctr >= 1 && lpv > 0 && lpvRate < 70)
    return { label:"Landing Page Problem",severity:"medium",  badge:"⚡ LP Issue",      problem:"People click but many don't reach the landing page.",           cause:"Slow loading, redirect issue, tracking problem, or poor mobile experience.",    action:"Run PageSpeed test, check link, compare Meta LPV with GA4 sessions." };
  if (addToCart > 0 && purchases / addToCart < 0.2)
    return { label:"Checkout Problem",    severity:"medium",  badge:"🛒 Checkout Issue",problem:"Users add to cart but don't complete purchase.",               cause:"Shipping cost, payment issue, hidden fees, weak urgency, or checkout friction.", action:"Audit checkout, payment methods, coupon codes, shipping fees, cart retargeting." };
  if (spend > 0 && roas < 1 && purchases === 0)
    return { label:"Losing Creative",     severity:"high",    badge:"🔴 Loser",         problem:"This ad is spending without generating purchases.",             cause:"Creative, offer, audience, or landing page may be misaligned.",                 action:"Pause or reduce spend. Review hook, offer, targeting, and LP before relaunch." };
  return   { label:"Monitor",            severity:"neutral", badge:"⚪ Monitor",        problem:"No clear winner or critical issue detected.",                   cause:"Performance is inconclusive based on current data.",                            action:"Keep monitoring until more spend and purchase volume are available." };
}

const TABS = [
  { key:"overview",   label:"Overview",   icon:"⬡" },
  { key:"campaigns",  label:"Campaigns",  icon:"◈" },
  { key:"adsets",     label:"Ad Sets",    icon:"◫" },
  { key:"ads",        label:"Ads",        icon:"▣" },
  { key:"creative",   label:"Creative",   icon:"✦" },
];

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:10, padding:"10px 14px" }}>
      <p style={{ color:"var(--muted)", fontSize:11, marginBottom:6 }}>{label}</p>
      {payload.map((p,i) => <p key={i} style={{ color:p.color, fontWeight:700, fontSize:12 }}>{p.name}: {typeof p.value==="number"?p.value.toLocaleString():p.value}</p>)}
    </div>
  );
};

function StatusDot({ effectiveStatus }) {
  if (!effectiveStatus) return <span style={{ color:"var(--muted-2)", fontSize:11 }}>—</span>;
  const st = effectiveStatus.toUpperCase();
  const cfg =
    st==="ACTIVE"          ? { color:"#06d6a0", label:"Active"       } :
    st==="PAUSED"          ? { color:"#f59e0b", label:"Paused"       } :
    st==="CAMPAIGN_PAUSED" ? { color:"#f59e0b", label:"Camp. Paused" } :
    st==="ADSET_PAUSED"    ? { color:"#f59e0b", label:"Set Paused"   } :
    st==="ARCHIVED"        ? { color:"#6b7ba4", label:"Archived"     } :
    st==="DISAPPROVED"     ? { color:"#f43f5e", label:"Disapproved"  } :
                             { color:"#6b7ba4", label:effectiveStatus };
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 8px", borderRadius:999, fontSize:11, fontWeight:700, color:cfg.color, background:`${cfg.color}12`, border:`1px solid ${cfg.color}25`, whiteSpace:"nowrap" }}>
      <span style={{ width:5, height:5, borderRadius:"50%", background:cfg.color, flexShrink:0, boxShadow:st==="ACTIVE"?`0 0 5px ${cfg.color}`:"none" }} />
      {cfg.label}
    </span>
  );
}

function SignalBadge({ row }) {
  const ctr=Number(row.ctr||0), cpm=Number(row.cpm||0), roas=Number(row.roas||0);
  const cfg =
    (roas>=3 && ctr>=1.5) ? { label:"Winner 🏆", color:"#f59e0b", bg:"rgba(245,158,11,0.1)" } :
    (roas>=2 || ctr>=1)   ? { label:"Scale ↑",  color:"#06d6a0", bg:"rgba(6,214,160,0.1)"  } :
    (ctr<0.5 || cpm>15)   ? { label:"Kill ✕",   color:"#f43f5e", bg:"rgba(244,63,94,0.1)"  } :
                             { label:"Watch",    color:"#f59e0b", bg:"rgba(245,158,11,0.08)" };
  return <span style={{ padding:"3px 9px", borderRadius:999, fontSize:11, fontWeight:700, color:cfg.color, background:cfg.bg, border:`1px solid ${cfg.color}25`, whiteSpace:"nowrap" }}>{cfg.label}</span>;
}

function KPICard({ label, value, delta, color, icon }) {
  const isUp = delta > 0;
  return (
    <div className="dash-kpi-card" style={{ position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:color, borderRadius:"20px 20px 0 0" }} />
      <div className="dash-kpi-top">
        <span className="dash-kpi-label">{label}</span>
        <span className="dash-kpi-icon">{icon}</span>
      </div>
      <strong style={{ color:"var(--text)", fontFamily:"'Space Grotesk',sans-serif", fontSize:24 }}>{value}</strong>
      {delta !== null && delta !== undefined && (
        <div style={{ fontSize:11, marginTop:5, display:"flex", alignItems:"center", gap:3, color: isUp ? "#06d6a0" : "#f43f5e" }}>
          {isUp ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}% vs prev
        </div>
      )}
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

function generateAlerts(summary) {
  const alerts=[];
  if (!summary) return alerts;
  const { roas=0, ctr=0, spend=0, purchase_value=0, purchases=0, add_to_cart=0, initiate_checkout=0 } = summary;
  if (spend>0 && purchase_value<spend) alerts.push({ severity:"high", title:"ROAS below profitability", message:"Ad spend exceeds tracked purchase value.", cause:"Weak CVR, low AOV, poor offer, or tracking gap.", action:"Pause weakest campaigns and review funnel before scaling.", ice:27 });
  if (Number(roas)>0 && Number(roas)<1.5) alerts.push({ severity:"high", title:"ROAS below 1.5x", message:"Campaigns may be unprofitable.", cause:"Low purchase value, weak CVR, or expensive traffic.", action:"Reduce budget on low ROAS campaigns. Test stronger offer/LP.", ice:26 });
  if (Number(ctr)>0 && Number(ctr)<0.8) alerts.push({ severity:"medium", title:"CTR below 0.8%", message:"Ads not generating enough clicks.", cause:"Weak hook, creative fatigue, wrong audience.", action:"Launch 3 new creatives with stronger hooks and Saudi-market angles.", ice:24 });
  if (Number(add_to_cart)>0 && Number(purchases)>0) {
    const cart=(Number(add_to_cart)-Number(purchases))/Number(add_to_cart)*100;
    if (cart>80) alerts.push({ severity:"medium", title:"High cart abandonment", message:`${cart.toFixed(1)}% abandon cart without purchase.`, cause:"Checkout friction, shipping cost, payment issue.", action:"Review checkout, payment options, retarget cart abandoners.", ice:23 });
  }
  if (Number(roas)>=3 && Number(ctr)>=1 && Number(purchases)>=5) alerts.push({ severity:"success", title:"Scaling opportunity", message:"ROAS, CTR, and purchase volume indicate scaling potential.", cause:"Strong offer-market fit.", action:"Increase budget 15–20% gradually while monitoring CPA and frequency.", ice:25 });
  if (alerts.length===0) alerts.push({ severity:"neutral", title:"No critical alerts", message:"Performance is stable based on current data.", cause:"No major profitability, acquisition, or funnel risk detected.", action:"Continue monitoring and test new creatives proactively.", ice:10 });
  return alerts.sort((a,b)=>b.ice-a.ice);
}

function diagnoseFunnel(summary) {
  const issues=[];
  if (!summary) return issues;
  const { lpv_rate=0, atc_rate=0, checkout_rate=0, purchase_rate=0, cart_abandonment_rate=0 } = summary;
  if (Number(lpv_rate)>0 && Number(lpv_rate)<70) issues.push({ stage:"Clicks → Landing Page", problem:"Users click but don't reach the LP.", cause:"Slow loading, redirect issue, or tracking gap.", action:"Run PageSpeed, check mobile, compare Meta clicks with GA4 sessions." });
  if (Number(atc_rate)>0 && Number(atc_rate)<8)  issues.push({ stage:"Landing Page → Add to Cart", problem:"Users arrive but don't add to cart.", cause:"Weak offer, poor product page trust, unclear CTA.", action:"Improve product page, add reviews, clarify offer and shipping." });
  if (Number(checkout_rate)>0 && Number(checkout_rate)<40) issues.push({ stage:"ATC → Initiate Checkout", problem:"Users add to cart but don't start checkout.", cause:"Cart UX issue, shipping surprise, weak urgency.", action:"Audit cart page, show delivery info earlier, add abandonment retargeting." });
  if (Number(purchase_rate)>0 && Number(purchase_rate)<30) issues.push({ stage:"Checkout → Purchase", problem:"Users start checkout but don't complete.", cause:"Payment failure, hidden costs, checkout friction.", action:"Test full purchase flow, payment methods, coupon codes, shipping fees." });
  if (issues.length===0) issues.push({ stage:"Funnel Health", problem:"No major bottleneck detected.", cause:"Funnel appears stable based on current thresholds.", action:"Keep monitoring and compare by campaign, ad set, and ad level." });
  return issues;
}

function diagnoseCreatives(rows) {
  const ORDER={ success:0, high:1, medium:2, neutral:3 };
  return rows.map(row => {
    const spend=Number(row.spend||0), purchases=Number(row.purchases||0), roas=Number(row.roas||0);
    const ctr=Number(row.ctr||0), frequency=Number(row.frequency||0);
    const hookRate=Number(row.hook_rate||0), holdRate=Number(row.hold_rate||0);
    const addToCart=Number(row.add_to_cart||0), lpv=Number(row.landing_page_views||0);
    const clicks=Number(row.clicks||0);
    const lpvRate=clicks>0?(lpv/clicks)*100:0;
    let diagnosis,severity,problem,action;
    if (roas>=3&&purchases>=3&&hookRate>=30&&frequency<4) { diagnosis="Winner Creative"; severity="success"; problem="Generating profitable purchases."; action="Duplicate, create 3 variations, increase budget 15–20%."; }
    else if (hookRate>0&&hookRate<20) { diagnosis="Hook Problem"; severity="high"; problem="First seconds not stopping scroll."; action="Test 3 new hooks. Show outcome, pain, or bold claim in first 2s."; }
    else if (hookRate>=30&&holdRate>0&&holdRate<10) { diagnosis="Hold Problem"; severity="medium"; problem="Hook works but users drop quickly."; action="Shorten video, improve pacing, show proof earlier."; }
    else if (hookRate>=25&&holdRate>=10&&ctr<1) { diagnosis="Offer/CTA Problem"; severity="medium"; problem="Watching but not clicking."; action="Test stronger CTA, clearer offer, urgency, or social proof."; }
    else if (frequency>4&&ctr<1) { diagnosis="Creative Fatigue"; severity="medium"; problem="Audience seen this too many times."; action="Refresh creative, test new angles, exclude saturated audiences."; }
    else if (ctr>=1&&lpv>0&&lpvRate<70) { diagnosis="Landing Page Problem"; severity:"medium"; problem:"Clicks but few reach LP."; action:"Run PageSpeed, check mobile, compare Meta LPV with GA4."; }
    else if (addToCart>0&&purchases/addToCart<0.2) { diagnosis="Checkout Problem"; severity="medium"; problem="Add to cart but don't purchase."; action:"Audit checkout, payment methods, shipping, cart abandonment."; }
    else if (spend>0&&roas<1&&purchases===0) { diagnosis="Losing Creative"; severity="high"; problem="Spending without generating purchases."; action="Pause. Review hook, offer, targeting, and LP before relaunch."; }
    else { diagnosis="Monitor"; severity="neutral"; problem="No clear winner or critical issue."; action:"Keep monitoring until more spend and purchase data available."; }
    return { adName:row.ad_name||"Unknown", campaignName:row.campaign_name||"", adsetName:row.adset_name||"", spend, purchases, roas, ctr, frequency, hookRate, holdRate, diagnosis, severity, problem, action };
  }).sort((a,b)=>ORDER[a.severity]-ORDER[b.severity]||b.spend-a.spend);
}

export default function MetaPage() {
  const [activeTab,    setActiveTab]    = useState("overview");
  const [accounts,     setAccounts]     = useState([]);
  const [accountId,    setAccountId]    = useState("");
  const [datePreset,   setDatePreset]   = useState("yesterday");
  const [customSince,  setCustomSince]  = useState("");
  const [customUntil,  setCustomUntil]  = useState("");
  const [showCustom,   setShowCustom]   = useState(false);

  // Campaign data
  const [campRows,     setCampRows]     = useState([]);
  const [campSummary,  setCampSummary]  = useState(null);
  const [campLoading,  setCampLoading]  = useState(false);

  // AdSet data
  const [adsetRows,    setAdsetRows]    = useState([]);
  const [adsetLoading, setAdsetLoading] = useState(false);
  const [adsetLoaded,  setAdsetLoaded]  = useState(false);

  // Ad data
  const [adRows,       setAdRows]       = useState([]);
  const [adLoading,    setAdLoading]    = useState(false);
  const [adLoaded,     setAdLoaded]     = useState(false);

  // Statuses
  const [campStatus,   setCampStatus]   = useState({});
  const [adsetStatus,  setAdsetStatus]  = useState({});
  const [adStatus,     setAdStatus]     = useState({});

  // Salla summary for real ROAS
  const [sallaSummary, setSallaSummary] = useState(null);
  const [creativeMap,  setCreativeMap]  = useState({});
  const [creativeFilter, setCreativeFilter] = useState("all");

  const [error,        setError]        = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => { loadAccounts(); loadSalla(); }, []);
  useEffect(() => { if (accountId) { resetData(); loadCampaigns(); } }, [accountId, datePreset]);
  useEffect(() => {
    if (accountId && (activeTab==="adsets") && !adsetLoaded) loadAdsets();
    if (accountId && (activeTab==="ads"||activeTab==="creative") && !adLoaded) loadAds();
  }, [activeTab, accountId]);

  function resetData() {
    setCampRows([]); setCampSummary(null);
    setAdsetRows([]); setAdsetLoaded(false);
    setAdRows([]); setAdLoaded(false);
    setError("");
  }

  async function loadAccounts() {
    try {
      const data = await apiGet("/api/meta/accounts");
      const list = data.data || [];
      setAccounts(list);
      const saved = getSetting("primary_meta_account","");
      const sel = saved || list[0]?.id || "";
      setAccountId(sel);
      if (sel) saveSetting("primary_meta_account", sel);
    } catch(e) { setError(e.message); }
  }

  async function loadSalla() {
    try {
      const d = await apiGet("/api/salla/summary");
      setSallaSummary(d);
    } catch {}
  }

  function buildDateParam() {
    if (datePreset === "custom" && customSince && customUntil) {
      return `since=${customSince}&until=${customUntil}`;
    }
    return `date_preset=${datePreset}`;
  }

  async function loadCampaigns() {
    if (!accountId) return;
    setCampLoading(true); setError("");
    try {
      const data = await apiGet(`/api/meta/insights?account_id=${accountId}&level=campaign&${buildDateParam()}`);
      setCampRows(data.data||[]); setCampSummary(data.summary||null);
      apiGet(`/api/meta/statuses?account_id=${accountId}&level=campaign`).then(s=>setCampStatus(s.statusMap||{})).catch(()=>{});
    } catch(e) { setError(e.message); }
    finally { setCampLoading(false); }
  }

  async function loadAdsets() {
    if (!accountId) return;
    setAdsetLoading(true);
    try {
      const data = await apiGet(`/api/meta/insights?account_id=${accountId}&level=adset&${buildDateParam()}`);
      setAdsetRows(data.data||[]); setAdsetLoaded(true);
      apiGet(`/api/meta/statuses?account_id=${accountId}&level=adset`).then(s=>setAdsetStatus(s.statusMap||{})).catch(()=>{});
    } catch(e) { setError(e.message); }
    finally { setAdsetLoading(false); }
  }

  async function loadAds() {
    if (!accountId) return;
    setAdLoading(true);
    try {
      const data = await apiGet(`/api/meta/insights?account_id=${accountId}&level=ad&${buildDateParam()}`);
      setAdRows(data.data||[]); setAdLoaded(true);
      apiGet(`/api/meta/statuses?account_id=${accountId}&level=ad`).then(s=>setAdStatus(s.statusMap||{})).catch(()=>{});
      // Fetch creative thumbnails in background
      const adIds = (data.data||[]).map(r=>r.ad_id).filter(Boolean);
      if (adIds.length) {
        apiGet(`/api/meta/creatives?ad_ids=${adIds.join(",")}`)
          .then(r => {
            const map = {};
            (r.data||[]).forEach(c => { map[c.ad_id] = c; });
            setCreativeMap(map);
          })
          .catch(() => {});
      }
    } catch(e) { setError(e.message); }
    finally { setAdLoading(false); }
  }

  function refresh() {
    resetData();
    loadCampaigns();
    if (activeTab==="adsets") { setAdsetLoaded(false); loadAdsets(); }
    if (activeTab==="ads"||activeTab==="creative") { setAdLoaded(false); loadAds(); }
  }

  // Computed
  const alerts  = useMemo(()=>generateAlerts(campSummary), [campSummary]);
  const funnel  = useMemo(()=>diagnoseFunnel(campSummary), [campSummary]);
  const totals  = campSummary || {};

  const chartData = useMemo(()=>
    campRows.slice(0,8).map(r=>({
      name:(r.campaign_name||"Unknown").slice(0,16),
      spend:+Number(r.spend||0).toFixed(2),
      revenue:+Number(r.purchase_value||0).toFixed(2),
    })), [campRows]);

  const rankedAds   = useMemo(()=>rankCreatives(adRows,"ad_name"), [adRows]);
  const adsSummary  = useMemo(()=>scoringSummary(rankedAds), [rankedAds]);
  const creativeDiag= useMemo(()=>diagnoseCreatives(adRows), [adRows]);

  const realROAS = sallaSummary && totals.spend
    ? (Number(sallaSummary.total_revenue||0) / Number(totals.spend||1))
    : null;

  const filteredCamps  = useMemo(()=> filterStatus==="all" ? campRows  : campRows.filter(r=>{const st=(campStatus[r.campaign_id||""]?.effective_status||"").toUpperCase(); return filterStatus==="active"?st==="ACTIVE":["PAUSED","CAMPAIGN_PAUSED"].includes(st);}), [campRows,campStatus,filterStatus]);
  const filteredAdsets = useMemo(()=> filterStatus==="all" ? adsetRows : adsetRows.filter(r=>{const st=(adsetStatus[r.adset_id||""]?.effective_status||"").toUpperCase(); return filterStatus==="active"?st==="ACTIVE":["PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED"].includes(st);}), [adsetRows,adsetStatus,filterStatus]);
  const filteredAds    = useMemo(()=> filterStatus==="all" ? rankedAds : rankedAds.filter(r=>{const st=(adStatus[r.ad_id||""]?.effective_status||"").toUpperCase(); return filterStatus==="active"?st==="ACTIVE":["PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED"].includes(st);}), [rankedAds,adStatus,filterStatus]);

  const ctrColor = (v) => Number(v||0)>=1?"var(--accent)":Number(v||0)>=0.5?"var(--gold)":"var(--red)";

  return (
    <main style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* ── Top Bar ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"#1877F220", border:"1px solid #1877F240", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:900, color:"#1877F2" }}>f</div>
          <div>
            <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:20, fontWeight:700, color:"var(--text)", letterSpacing:"-0.3px" }}>Meta Ads</h1>
            <p style={{ fontSize:12, color:"var(--muted)" }}>{accounts.find(a=>a.id===accountId)?.name || "No account selected"}</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          {accounts.length > 0 && (
            <select value={accountId} onChange={e=>{ setAccountId(e.target.value); saveSetting("primary_meta_account",e.target.value); }} style={{ background:"var(--card)", color:"var(--text)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"8px 12px", fontSize:12, fontWeight:600, fontFamily:"inherit", outline:"none", cursor:"pointer" }}>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name} — {a.currency}</option>)}
            </select>
          )}
          <select value={datePreset} onChange={e => {
            const v = e.target.value;
            setDatePreset(v);
            setShowCustom(v === "custom");
            if (v !== "custom") { setCustomSince(""); setCustomUntil(""); }
          }} style={{ background:"var(--card)", color:"var(--text)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"8px 12px", fontSize:12, fontWeight:600, fontFamily:"inherit", outline:"none", cursor:"pointer" }}>
            {DATE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="dash-refresh" onClick={refresh} disabled={campLoading}>{campLoading?"⏳":"↺"} Refresh</button>
        </div>
      </div>

      {showCustom && (
        <DateRangePicker
          since={customSince}
          until={customUntil}
          onApply={(from, to) => {
            setCustomSince(from);
            setCustomUntil(to);
            resetData();
            loadCampaigns();
          }}
        />
      )}

      {/* Active date label */}
      {datePreset === "custom" && customSince && customUntil && (
        <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600 }}>
          📅 Custom range: {customSince} → {customUntil}
        </div>
      )}
      <div style={{ display:"flex", gap:4, background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:4 }}>
        {TABS.map(tab=>(
          <button key={tab.key} onClick={()=>setActiveTab(tab.key)} style={{ flex:1, padding:"8px 12px", borderRadius:"var(--radius-md)", border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:activeTab===tab.key?700:500, display:"flex", alignItems:"center", justifyContent:"center", gap:5, transition:"all 0.15s",
            background: activeTab===tab.key?"var(--card-2)":"transparent",
            color: activeTab===tab.key?"var(--text)":"var(--muted)",
            borderBottom: activeTab===tab.key?"2px solid var(--primary)":"2px solid transparent"
          }}>
            <span>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="dash-message error">⚠ {error}</div>}

      {/* ══ OVERVIEW TAB ══ */}
      {activeTab==="overview" && (
        <>
          {/* Alert */}
          {alerts.length > 0 && alerts[0].severity !== "neutral" && (
            <div style={{ background: alerts[0].severity==="high"?"rgba(244,63,94,0.08)":"rgba(245,158,11,0.08)", border:`1px solid ${alerts[0].severity==="high"?"rgba(244,63,94,0.25)":"rgba(245,158,11,0.25)"}`, borderRadius:"var(--radius-md)", padding:"10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
              <p style={{ fontSize:12, color:alerts[0].severity==="high"?"var(--red)":"var(--gold)" }}>
                <strong>{alerts.filter(a=>a.severity==="high"||a.severity==="medium").length} alerts:</strong> {alerts[0].title} — {alerts[0].message}
              </p>
              <button onClick={()=>setActiveTab("overview")} style={{ fontSize:11, background:"transparent", border:`0.5px solid ${alerts[0].severity==="high"?"var(--red)":"var(--gold)"}`, borderRadius:"var(--radius-md)", padding:"4px 10px", cursor:"pointer", color:alerts[0].severity==="high"?"var(--red)":"var(--gold)", fontFamily:"inherit", whiteSpace:"nowrap" }}>View Details</button>
            </div>
          )}

          {/* KPIs */}
          <SectionLabel icon="📊" title="Overview" />
          <div className="dash-kpi-grid">
            <KPICard label="Spend"     value={campLoading?"—":fmt.money(totals.spend)}          color="#6366f1" icon="💰" />
            <KPICard label="Revenue"   value={campLoading?"—":fmt.money(totals.purchase_value)} color="#06d6a0" icon="💵" />
            <KPICard label="ROAS"      value={campLoading?"—":fmt.x(totals.roas)}               color="#06d6a0" icon="📈" />
            <KPICard label="Purchases" value={campLoading?"—":fmt.number(totals.purchases)}     color="#f59e0b" icon="🛒" />
            <KPICard label="CPA"       value={campLoading?"—":fmt.money(totals.cpa)}            color="#f43f5e" icon="🎯" />
            <KPICard label="CTR"       value={campLoading?"—":fmt.percent(totals.ctr)}          color="#8b5cf6" icon="📊" />
          </div>

          {/* Real ROAS from Salla */}
          {realROAS !== null && (
            <div style={{ background:"rgba(6,214,160,0.06)", border:"1px solid rgba(6,214,160,0.2)", borderRadius:"var(--radius-lg)", padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--accent)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:4 }}>Real ROAS (Meta Spend ÷ Salla Revenue)</div>
                <div style={{ fontSize:28, fontWeight:700, color:"var(--accent)", fontFamily:"'Space Grotesk',sans-serif" }}>{realROAS.toFixed(2)}x</div>
              </div>
              <div style={{ textAlign:"right", fontSize:12, color:"var(--muted)" }}>
                <div>Salla Revenue: <strong style={{ color:"var(--text)" }}>{Number(sallaSummary.total_revenue||0).toLocaleString()} SAR</strong></div>
                <div>Orders: <strong style={{ color:"var(--text)" }}>{sallaSummary.total_orders}</strong></div>
              </div>
            </div>
          )}

          {/* Chart + Funnel */}
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:14 }}>
            <div className="dash-chart-card">
              <div className="dash-chart-head"><div><h2>Revenue vs Spend</h2><p>Top campaigns — {DATE_OPTIONS.find(d=>d.value===datePreset)?.label}</p></div></div>
              <div className="dash-chart-box">
                {chartData.length===0 ? <div className="dash-empty"><h3>{campLoading?"⏳ Loading...":"No data"}</h3></div> :
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barGap={3}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill:"rgba(99,102,241,0.04)" }} />
                    <Bar dataKey="revenue" name="Revenue ($)" fill="#06d6a0" radius={[5,5,0,0]} />
                    <Bar dataKey="spend"   name="Spend ($)"   fill="#6366f1" radius={[5,5,0,0]} />
                  </BarChart>
                </ResponsiveContainer>}
              </div>
            </div>
            <div className="dash-chart-card">
              <div className="dash-chart-head"><div><h2>Funnel health</h2></div></div>
              {[
                { label:"Impressions", val:fmt.compact(totals.impressions), rate:null },
                { label:"Link Clicks", val:fmt.compact(totals.clicks), rate:`CTR ${fmt.percent(totals.ctr)}`, warn:Number(totals.ctr||0)<0.8 },
                { label:"Landing Page", val:fmt.compact(totals.landing_page_views||0), rate:totals.lpv_rate?`LPV ${fmt.percent(totals.lpv_rate)}`:null, warn:Number(totals.lpv_rate||0)>0&&Number(totals.lpv_rate||0)<70 },
                { label:"Add to Cart", val:fmt.compact(totals.add_to_cart), rate:totals.atc_rate?`ATC ${fmt.percent(totals.atc_rate)}`:null },
                { label:"Purchases",   val:fmt.compact(totals.purchases), rate:totals.purchase_rate?`CVR ${fmt.percent(totals.purchase_rate)}`:null },
              ].map((step,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 0", borderBottom:i<4?"1px solid var(--border)":"none" }}>
                  <div style={{ width:22, height:22, borderRadius:6, background:"var(--glass-2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"var(--muted)", flexShrink:0 }}>{i+1}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:10, color:"var(--muted)", marginBottom:1 }}>{step.label}</div>
                    <div style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>{campLoading?"—":step.val}</div>
                  </div>
                  {step.rate && <span style={{ fontSize:10, fontWeight:700, color:step.warn?"var(--red)":"var(--accent)", whiteSpace:"nowrap" }}>{step.rate}{step.warn?" ⚠":""}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Funnel Diagnosis */}
          {funnel.length>0 && funnel[0].stage!=="Funnel Health" && (
            <>
              <SectionLabel icon="🔍" title="Funnel diagnosis" />
              <div className="dash-insights-grid">
                {funnel.map((item,i)=>(
                  <div className="dash-insight-card" key={i} dir="ltr">
                    <h3 style={{ color:"var(--accent)" }}>{item.stage}</h3>
                    <p><strong>Problem:</strong> {item.problem}</p>
                    <p><strong>Cause:</strong> {item.cause}</p>
                    <p><strong>Action:</strong> {item.action}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Creative snapshot */}
          {adLoaded && rankedAds.length > 0 && (
            <>
              <SectionLabel icon="✦" title="Creative snapshot" />
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                {rankedAds.slice(0,4).map((row,i)=>{
                  const s=row._scoring;
                  const bc=s.score>=75?"#f59e0b":s.score>=55?"#06d6a0":s.score>=35?"#6366f1":"#f43f5e";
                  return (
                    <div key={i} style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:12, display:"flex", flexDirection:"column", gap:8 }}>
                      <div style={{ height:44, background:"var(--glass)", borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"var(--muted-2)" }}>🖼</div>
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

      {/* ══ STATUS FILTER (shared for campaigns/adsets/ads) ══ */}
      {["campaigns","adsets","ads"].includes(activeTab) && (
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:11, fontWeight:700, color:"var(--muted-2)", textTransform:"uppercase", letterSpacing:"1px" }}>Status:</span>
          {[{key:"all",label:"All"},{key:"active",label:"🟢 Active"},{key:"paused",label:"🟡 Paused"}].map(f=>(
            <button key={f.key} onClick={()=>setFilterStatus(f.key)} style={{ padding:"5px 12px", borderRadius:999, fontSize:11, fontWeight:700, border:`1px solid ${filterStatus===f.key?"var(--primary)":"var(--border)"}`, background:filterStatus===f.key?"rgba(99,102,241,0.12)":"transparent", color:filterStatus===f.key?"var(--primary)":"var(--muted)", cursor:"pointer", fontFamily:"inherit" }}>{f.label}</button>
          ))}
        </div>
      )}

      {/* ══ CAMPAIGNS TAB ══ */}
      {activeTab==="campaigns" && (
        <div className="dash-table-card">
          <div className="dash-table-head">
            <div><h2>Campaigns</h2><p>{campLoading?"Loading...":filteredCamps.length+" campaigns"}</p></div>
          </div>
          {campLoading ? <div className="dash-empty"><h3>⏳ Loading...</h3></div> :
          filteredCamps.length===0 ? <div className="dash-empty"><h3>No campaigns</h3></div> :
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead><tr><th>Campaign</th><th>Status</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>Purchases</th><th>CPA</th><th>CTR</th><th>CPM</th><th>Signal</th></tr></thead>
              <tbody>
                {filteredCamps.map((row,i)=>(
                  <tr key={i}>
                    <td className="dash-name-cell">{row.campaign_name||"Unknown"}</td>
                    <td><StatusDot effectiveStatus={campStatus[row.campaign_id||""]?.effective_status}/></td>
                    <td>{fmt.money(row.spend)}</td>
                    <td>{fmt.money(row.purchase_value)}</td>
                    <td style={{ color:Number(row.roas||0)>=2?"var(--accent)":Number(row.roas||0)>=1?"var(--gold)":"var(--red)", fontWeight:700 }}>{fmt.x(row.roas)}</td>
                    <td>{fmt.number(row.purchases)}</td>
                    <td>{fmt.money(row.cpa)}</td>
                    <td style={{ color:ctrColor(row.ctr), fontWeight:700 }}>{fmt.percent(row.ctr)}</td>
                    <td>{fmt.money(row.cpm)}</td>
                    <td><SignalBadge row={row}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}

      {/* ══ ADSETS TAB ══ */}
      {activeTab==="adsets" && (
        <div className="dash-table-card">
          <div className="dash-table-head">
            <div><h2>Ad Sets</h2><p>{adsetLoading?"Loading...":filteredAdsets.length+" ad sets"}</p></div>
          </div>
          {adsetLoading ? <div className="dash-empty"><h3>⏳ Loading...</h3></div> :
          filteredAdsets.length===0 ? <div className="dash-empty"><h3>No ad sets</h3></div> :
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead><tr><th>Ad Set</th><th>Campaign</th><th>Status</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>Purchases</th><th>CTR</th><th>Frequency</th><th>Signal</th></tr></thead>
              <tbody>
                {filteredAdsets.map((row,i)=>(
                  <tr key={i}>
                    <td className="dash-name-cell">{row.adset_name||"Unknown"}</td>
                    <td style={{ color:"var(--muted)", fontSize:12, maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row.campaign_name}</td>
                    <td><StatusDot effectiveStatus={adsetStatus[row.adset_id||""]?.effective_status}/></td>
                    <td>{fmt.money(row.spend)}</td>
                    <td>{fmt.money(row.purchase_value)}</td>
                    <td style={{ color:Number(row.roas||0)>=2?"var(--accent)":Number(row.roas||0)>=1?"var(--gold)":"var(--red)", fontWeight:700 }}>{fmt.x(row.roas)}</td>
                    <td>{fmt.number(row.purchases)}</td>
                    <td style={{ color:ctrColor(row.ctr), fontWeight:700 }}>{fmt.percent(row.ctr)}</td>
                    <td style={{ color:Number(row.frequency||0)>=3.5?"var(--red)":Number(row.frequency||0)>=3?"var(--gold)":"var(--text-2)", fontWeight:Number(row.frequency||0)>=3.5?700:400 }}>{Number(row.frequency||0).toFixed(2)}</td>
                    <td><SignalBadge row={row}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
        </div>
      )}

      {/* ══ ADS TAB ══ */}
      {activeTab==="ads" && (
        <>
          {!adLoaded && <div className="dash-empty"><h3>{adLoading?"⏳ Loading ads...":"Ads will load when you switch to this tab."}</h3></div>}
          {adLoaded && (
            <>
              {/* Summary */}
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
                {filteredAds.map((row,i)=>{
                  const s=row._scoring;
                  const bc=s.score>=75?"#f59e0b":s.score>=55?"#06d6a0":s.score>=35?"#6366f1":"#f43f5e";
                  return (
                    <div key={i} style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:"var(--radius-xl)", padding:"14px 18px", display:"grid", gridTemplateColumns:"2fr 90px 70px 80px 80px 70px 70px 110px", gap:12, alignItems:"center" }}>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row._name}</div>
                        {s.diagnosis.primaryIssue && <div style={{ fontSize:11, color:"var(--red)", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>⚠ {s.diagnosis.primaryIssue}</div>}
                        {!s.diagnosis.primaryIssue && s.diagnosis.primaryWin && <div style={{ fontSize:11, color:"var(--accent)", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>✓ {s.diagnosis.primaryWin}</div>}
                      </div>
                      <div><div style={{ fontSize:9, color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:3 }}>Status</div><StatusDot effectiveStatus={adStatus[row.ad_id||""]?.effective_status}/></div>
                      {[
                        { label:"Score", content:<div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ flex:1, height:5, background:"rgba(255,255,255,0.06)", borderRadius:3, overflow:"hidden" }}><div style={{ height:"100%", width:`${s.score}%`, background:bc, borderRadius:3 }}/></div><span style={{ fontSize:11, fontWeight:700, color:bc }}>{s.score}</span></div> },
                        { label:"Spend", content:<div style={{ fontSize:12, fontWeight:600, color:"var(--text)" }}>{fmt.money(row.spend)}</div> },
                        { label:"ROAS",  content:<div style={{ fontSize:12, fontWeight:700, color:Number(row.roas||0)>=2?"var(--accent)":Number(row.roas||0)>=1?"var(--gold)":"var(--red)" }}>{fmt.x(row.roas)}</div> },
                        { label:"Hook",  content:<div style={{ fontSize:12, fontWeight:600, color:Number(row.hook_rate||0)>=25?"var(--accent)":"var(--text)" }}>{Number(row.hook_rate||0)>0?fmt.percent(row.hook_rate):"—"}</div> },
                        { label:"Hold",  content:<div style={{ fontSize:12, fontWeight:600, color:Number(row.hold_rate||0)>=40?"var(--accent)":"var(--text)" }}>{Number(row.hold_rate||0)>0?fmt.percent(row.hold_rate):"—"}</div> },
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
          {!adLoaded && <div className="dash-empty"><h3>{adLoading?"⏳ Loading ads...":"Switch to this tab to load creative data."}</h3></div>}
          {adLoaded && (() => {
            // Sort: winners → highest ROAS → purchases → spend
            const SEVERITY_ORDER = { success:0, high:1, medium:2, neutral:3 };
            const diagnosed = adRows.map(row => ({ ...row, _diag: diagnoseCreative(row) }))
              .sort((a,b) => {
                const so = SEVERITY_ORDER[a._diag.severity] - SEVERITY_ORDER[b._diag.severity];
                if (so!==0) return so;
                const rd = Number(b.roas||0) - Number(a.roas||0);
                if (rd!==0) return rd;
                const pd = Number(b.purchases||0) - Number(a.purchases||0);
                if (pd!==0) return pd;
                return Number(b.spend||0) - Number(a.spend||0);
              });

            const filtered = diagnosed.filter(row => {
              if (creativeFilter==="all")        return true;
              if (creativeFilter==="winners")    return row._diag.severity==="success";
              if (creativeFilter==="problems")   return row._diag.severity==="high";
              if (creativeFilter==="fatigue")    return row._diag.label==="Creative Fatigue";
              if (creativeFilter==="no_purchase")return Number(row.purchases||0)===0;
              return true;
            });

            const totalSpend   = adRows.reduce((s,r)=>s+Number(r.spend||0),0);
            const totalPur     = adRows.reduce((s,r)=>s+Number(r.purchases||0),0);
            const totalRev     = adRows.reduce((s,r)=>s+Number(r.purchase_value||0),0);
            const avgROAS      = totalSpend ? totalRev/totalSpend : 0;
            const avgCPA       = totalPur   ? totalSpend/totalPur : 0;
            const winnersCount = diagnosed.filter(r=>r._diag.severity==="success").length;
            const problemsCount= diagnosed.filter(r=>r._diag.severity==="high").length;

            return (
              <>
                {/* Summary KPIs */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:10 }}>
                  {[
                    { label:"Total Spend",    val:fmt.money(totalSpend),       color:"#6366f1" },
                    { label:"Purchases",      val:fmt.number(totalPur),        color:"#f59e0b" },
                    { label:"Revenue",        val:fmt.money(totalRev),         color:"#06d6a0" },
                    { label:"Avg ROAS",       val:fmt.x(avgROAS),              color:"#06d6a0" },
                    { label:"Avg CPA",        val:fmt.money(avgCPA),           color:"#f43f5e" },
                    { label:"Winners 🏆",     val:winnersCount,                color:"#f59e0b" },
                    { label:"Problems 🔴",    val:problemsCount,               color:"#f43f5e" },
                  ].map(k=>(
                    <div key={k.label} className="dash-kpi-card" style={{ padding:"14px 16px" }}>
                      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:k.color, borderRadius:"20px 20px 0 0" }} />
                      <div style={{ fontSize:9, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:8 }}>{k.label}</div>
                      <strong style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:700, color:k.color }}>{k.val}</strong>
                    </div>
                  ))}
                </div>

                {/* Filter pills */}
                <div style={{ display:"flex", gap:7, flexWrap:"wrap", alignItems:"center" }}>
                  {[
                    { key:"all",        label:`All (${diagnosed.length})`,                              color:"var(--muted)"  },
                    { key:"winners",    label:`🏆 Winners (${winnersCount})`,                            color:"#f59e0b"       },
                    { key:"problems",   label:`🔴 Problems (${problemsCount})`,                          color:"#f43f5e"       },
                    { key:"fatigue",    label:`🔁 Fatigue (${diagnosed.filter(r=>r._diag.label==="Creative Fatigue").length})`, color:"#f59e0b" },
                    { key:"no_purchase",label:`💸 No Purchase (${diagnosed.filter(r=>Number(r.purchases||0)===0).length})`, color:"#6366f1" },
                  ].map(f=>(
                    <button key={f.key} onClick={()=>setCreativeFilter(f.key)} style={{ padding:"6px 13px", borderRadius:999, fontSize:11, fontWeight:700, border:`1px solid ${creativeFilter===f.key?f.color:"var(--border)"}`, background:creativeFilter===f.key?`${f.color}15`:"transparent", color:creativeFilter===f.key?f.color:"var(--muted)", cursor:"pointer", fontFamily:"inherit" }}>{f.label}</button>
                  ))}
                </div>

                {/* Gallery Grid */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
                  {filtered.map((row, i) => {
                    const diag    = row._diag;
                    const creative= creativeMap[row.ad_id || ""] || {};
                    const thumb   = creative.thumbnail_url || creative.image_url || null;
                    const mType   = creative.media_type || (Number(row.hook_rate||0)>0 ? "video" : null);

                    const sevColor =
                      diag.severity==="success" ? "#f59e0b" :
                      diag.severity==="high"    ? "#f43f5e" :
                      diag.severity==="medium"  ? "#f59e0b" : "var(--muted)";
                    const sevBg =
                      diag.severity==="success" ? "rgba(245,158,11,0.1)" :
                      diag.severity==="high"    ? "rgba(244,63,94,0.1)"  :
                      diag.severity==="medium"  ? "rgba(245,158,11,0.08)": "rgba(148,163,184,0.08)";

                    return (
                      <div key={i} style={{ background:"var(--card)", border:`1px solid ${diag.severity==="success"?"rgba(245,158,11,0.3)":diag.severity==="high"?"rgba(244,63,94,0.2)":"var(--border)"}`, borderRadius:"var(--radius-xl)", overflow:"hidden", transition:"transform 0.2s", display:"flex", flexDirection:"column" }}
                        onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                        onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}
                      >
                        {/* Preview */}
                        <div style={{ height:140, background:"var(--glass)", position:"relative", overflow:"hidden", flexShrink:0 }}>
                          {thumb
                            ? <img src={thumb} alt={row.ad_name} style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={e=>{e.target.style.display="none"}} />
                            : <div style={{ width:"100%", height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8 }}>
                                <span style={{ fontSize:28, opacity:0.3 }}>🖼</span>
                                <span style={{ fontSize:11, color:"var(--muted2)" }}>No Creative Preview</span>
                              </div>
                          }
                          {/* Media type badge */}
                          {mType && (
                            <div style={{ position:"absolute", top:8, right:8, padding:"3px 9px", borderRadius:999, fontSize:10, fontWeight:700, background:"rgba(0,0,0,0.7)", color:"#fff", backdropFilter:"blur(4px)" }}>
                              {mType==="video" ? "🎬 Video" : mType==="image" ? "🖼 Image" : "❓ Unknown"}
                            </div>
                          )}
                          {/* Status overlay */}
                          <div style={{ position:"absolute", top:8, left:8 }}>
                            <StatusDot effectiveStatus={adStatus[row.ad_id||""]?.effective_status} />
                          </div>
                        </div>

                        <div style={{ padding:"14px", display:"flex", flexDirection:"column", gap:10, flex:1 }}>
                          {/* Ad identity */}
                          <div>
                            <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={row.ad_name}>{row.ad_name || "Unknown"}</div>
                            <div style={{ fontSize:10, color:"var(--muted)", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row.campaign_name}</div>
                            <div style={{ fontSize:10, color:"var(--muted2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{row.adset_name}</div>
                          </div>

                          {/* Core decision metrics */}
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                            {[
                              { label:"Spend",     val:fmt.money(row.spend) },
                              { label:"Purchases", val:fmt.number(row.purchases) },
                              { label:"Revenue",   val:fmt.money(row.purchase_value) },
                              { label:"ROAS",      val:fmt.x(row.roas),    color:Number(row.roas||0)>=2?"var(--accent)":Number(row.roas||0)>=1?"var(--gold)":"var(--red)" },
                              { label:"CPA",       val:fmt.money(row.cpa) },
                              { label:"CTR",       val:fmt.percent(row.ctr), color:Number(row.ctr||0)>=1?"var(--accent)":Number(row.ctr||0)>=0.5?"var(--gold)":"var(--red)" },
                            ].map(m=>(
                              <div key={m.label} style={{ background:"var(--glass)", borderRadius:"var(--radius-sm)", padding:"7px 8px" }}>
                                <div style={{ fontSize:9, color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:2 }}>{m.label}</div>
                                <div style={{ fontSize:13, fontWeight:700, color:m.color||"var(--text)" }}>{m.val}</div>
                              </div>
                            ))}
                          </div>

                          {/* Creative metrics — only if video */}
                          {(Number(row.hook_rate||0) > 0 || Number(row.hold_rate||0) > 0) && (
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                              {[
                                { label:"Hook Rate",   val:fmt.percent(row.hook_rate),       color:Number(row.hook_rate||0)>=25?"var(--accent)":"var(--text)" },
                                { label:"Hold Rate",   val:fmt.percent(row.hold_rate),       color:Number(row.hold_rate||0)>=40?"var(--accent)":"var(--text)" },
                                { label:"Completion",  val:fmt.percent(row.completion_rate), color:"var(--text)" },
                              ].map(m=>(
                                <div key={m.label} style={{ background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.12)", borderRadius:"var(--radius-sm)", padding:"7px 8px" }}>
                                  <div style={{ fontSize:9, color:"var(--muted)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:2 }}>{m.label}</div>
                                  <div style={{ fontSize:13, fontWeight:700, color:m.color }}>{m.val}</div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Funnel */}
                          <div style={{ display:"flex", gap:4, fontSize:10, color:"var(--muted)", flexWrap:"wrap" }}>
                            {[
                              { label:"LPV", val:fmt.compact(row.landing_page_views||0) },
                              { label:"ATC", val:fmt.compact(row.add_to_cart||0) },
                              { label:"IC",  val:fmt.compact(row.initiate_checkout||0) },
                              { label:"Buy", val:fmt.compact(row.purchases||0) },
                            ].map((f,fi)=>(
                              <span key={f.label} style={{ display:"flex", alignItems:"center", gap:3 }}>
                                {fi>0 && <span style={{ color:"var(--muted2)" }}>›</span>}
                                <span style={{ color:"var(--muted2)" }}>{f.label}</span>
                                <span style={{ color:"var(--text)", fontWeight:600 }}>{f.val}</span>
                              </span>
                            ))}
                          </div>

                          {/* Diagnosis */}
                          <div style={{ background:sevBg, border:`1px solid ${sevColor}25`, borderRadius:"var(--radius-md)", padding:"10px 12px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                              <span style={{ fontSize:11, fontWeight:700, color:sevColor }}>{diag.badge}</span>
                            </div>
                            <div style={{ fontSize:11, color:"var(--text2)", marginBottom:4 }}><strong style={{ color:"var(--text)" }}>Problem:</strong> {diag.problem}</div>
                            <div style={{ fontSize:11, color:"var(--muted)" }}><strong>Action:</strong> {diag.action}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {filtered.length === 0 && (
                  <div className="dash-empty"><h3>No ads match this filter</h3></div>
                )}
              </>
            );
          })()}
        </>
      )}
    </main>
  );
}
