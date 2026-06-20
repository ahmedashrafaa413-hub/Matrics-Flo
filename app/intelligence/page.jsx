"use client";

import { useEffect, useState } from "react";
import { getSetting } from "../../lib/storage";

const DATE_OPTIONS = [
  { value:"today",      label:"اليوم"        },
  { value:"yesterday",  label:"أمس"          },
  { value:"last_7d",    label:"آخر 7 أيام"   },
  { value:"last_30d",   label:"آخر 30 يوم"   },
  { value:"maximum",    label:"كل الفترة"    },
];

const SIGNAL_CFG = {
  success: { color:"#06d6a0", bg:"rgba(6,214,160,0.08)",  border:"rgba(6,214,160,0.2)",  icon:"✅" },
  warning: { color:"#f59e0b", bg:"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.2)", icon:"⚠️" },
  danger:  { color:"#f43f5e", bg:"rgba(244,63,94,0.08)",  border:"rgba(244,63,94,0.2)",  icon:"🔴" },
  neutral: { color:"#8b95c9", bg:"rgba(139,149,201,0.06)",border:"rgba(139,149,201,0.15)",icon:"ℹ️" },
};

function sar(v) { return `${Number(v||0).toLocaleString("ar-SA", { minimumFractionDigits:2, maximumFractionDigits:2 })} ﷼`; }
function x(v)   { return `${Number(v||0).toFixed(2)}x`; }

// ── Signal Card ───────────────────────────────────────────────────────────────
function SignalCard({ signal }) {
  const cfg = SIGNAL_CFG[signal.type] || SIGNAL_CFG.neutral;
  return (
    <div style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:16, padding:"16px 18px", display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>{cfg.icon}</span>
          <span style={{ fontSize:13, fontWeight:800, color:cfg.color }}>{signal.title}</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <span style={{ fontSize:10, fontWeight:700, color:cfg.color, background:`${cfg.color}15`, padding:"3px 8px", borderRadius:999, whiteSpace:"nowrap" }}>
            {signal.platform}
          </span>
          <span style={{ fontSize:10, fontWeight:700, color:"var(--muted)", background:"var(--glass-2)", padding:"3px 8px", borderRadius:999 }}>
            ICE {signal.ice}
          </span>
        </div>
      </div>
      <div style={{ fontSize:11, color:"var(--muted2)", display:"flex", flexDirection:"column", gap:4 }}>
        <span><strong style={{ color:"var(--muted)" }}>المشكلة:</strong> {signal.problem}</span>
        <span><strong style={{ color:"var(--muted)" }}>السبب:</strong> {signal.cause}</span>
      </div>
      <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid var(--border)", borderRadius:10, padding:"10px 12px" }}>
        <span style={{ fontSize:12, color:cfg.color, fontWeight:700 }}>⚡ الإجراء: </span>
        <span style={{ fontSize:12, color:"var(--text-2)" }}>{signal.action}</span>
      </div>
    </div>
  );
}

// ── Markdown-like renderer ────────────────────────────────────────────────────
function AnalysisRenderer({ text }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }} dir="rtl">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height:8 }} />;
        if (line.startsWith("## ") || line.startsWith("# ")) {
          return <h2 key={i} style={{ fontSize:16, fontWeight:800, color:"var(--text)", fontFamily:"'Space Grotesk',sans-serif", marginTop:16, marginBottom:4 }}>{line.replace(/^#+\s/, "")}</h2>;
        }
        if (line.startsWith("**") && line.endsWith("**")) {
          const clean = line.replace(/\*\*/g, "");
          return <p key={i} style={{ fontSize:14, fontWeight:800, color:"var(--accent)", marginTop:10 }}>{clean}</p>;
        }
        if (line.match(/^\*\*\d+\./)) {
          const clean = line.replace(/\*\*/g, "");
          return <p key={i} style={{ fontSize:14, fontWeight:800, color:"var(--text)", marginTop:8, marginBottom:2 }}>{clean}</p>;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"4px 0" }}>
              <span style={{ color:"var(--accent)", flexShrink:0, marginTop:2, fontSize:12 }}>◆</span>
              <p style={{ fontSize:13, color:"var(--text-2)", lineHeight:1.6, margin:0 }}>{line.replace(/^[-•]\s/, "")}</p>
            </div>
          );
        }
        // Inline bold
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
          <p key={i} style={{ fontSize:13, color:"var(--text-2)", lineHeight:1.7, margin:0 }}>
            {parts.map((p, j) => j%2===1 ? <strong key={j} style={{ color:"var(--text)", fontWeight:700 }}>{p}</strong> : p)}
          </p>
        );
      })}
    </div>
  );
}

// ── KPI Strip ─────────────────────────────────────────────────────────────────
function KPIStrip({ meta, snap, salla }) {
  const totalSpend = (meta?.spend_sar||0) + (snap?.spend_sar||0);
  const actualROAS = totalSpend > 0 ? (salla?.revenue||0) / totalSpend : 0;
  const roasColor  = actualROAS >= 3 ? "#06d6a0" : actualROAS >= 1.5 ? "#f59e0b" : "#f43f5e";

  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px,1fr))", gap:10 }}>
      {[
        { label:"Meta Spend", val:sar(meta?.spend_sar||0),  color:"#6366f1" },
        { label:"Meta ROAS",  val:x(meta?.roas||0),         color:"#06d6a0" },
        { label:"Snap Spend", val:sar(snap?.spend_sar||0),  color:"#fffc00" },
        { label:"Snap ROAS",  val:x(snap?.roas||0),         color:"#06d6a0" },
        { label:"سلة مبيعات", val:sar(salla?.revenue||0),  color:"#8b5cf6" },
        { label:"سلة طلبات",  val:String(salla?.orders||0), color:"#8b5cf6" },
        { label:"ROAS الفعلي",val:x(actualROAS),            color:roasColor  },
        { label:"إنفاق كلي",  val:sar(totalSpend),          color:"#f59e0b"  },
      ].map(k => (
        <div key={k.label} style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:14, padding:"14px 14px", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:k.color, borderRadius:"14px 14px 0 0" }} />
          <div style={{ fontSize:10, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:6 }}>{k.label}</div>
          <div style={{ fontSize:18, fontWeight:900, color:k.color, fontFamily:"'Space Grotesk',sans-serif" }}>{k.val}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function IntelligencePage() {
  const [datePreset,   setDatePreset]   = useState("last_7d");
  const [loading,      setLoading]      = useState(false);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState("");
  const [metaAccId,    setMetaAccId]    = useState("");
  const [snapAccId,    setSnapAccId]    = useState("");
  const [metaAccounts, setMetaAccounts] = useState([]);
  const [snapAccounts, setSnapAccounts] = useState([]);
  const [activeTab,    setActiveTab]    = useState("signals");

  useEffect(() => {
    setMetaAccId(getSetting("primary_meta_account",""));
    setSnapAccId(getSetting("primary_snapchat_account",""));
    fetch("/api/meta/accounts",     { credentials:"include" }).then(r=>r.json()).then(d=>setMetaAccounts(d.data||[])).catch(()=>{});
    fetch("/api/snapchat/accounts", { credentials:"include" }).then(r=>r.json()).then(d=>setSnapAccounts(d.data||[])).catch(()=>{});
  }, []);

  async function analyze() {
    setLoading(true); setError(""); setResult(null);
    try {
      const res  = await fetch("/api/intelligence/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ metaAccountId: metaAccId, snapAccountId: snapAccId, datePreset }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "فشل التحليل");
      setResult(data);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const signalCounts = result ? {
    danger:  result.signals.filter(s=>s.type==="danger").length,
    warning: result.signals.filter(s=>s.type==="warning").length,
    success: result.signals.filter(s=>s.type==="success").length,
  } : null;

  return (
    <main style={{ display:"flex", flexDirection:"column", gap:18 }} dir="rtl">

      {/* ── Header ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.2)", borderRadius:999, padding:"5px 12px", fontSize:11, fontWeight:700, color:"var(--primary)", textTransform:"uppercase", letterSpacing:"1px", marginBottom:10 }}>
            🧠 AI-Powered
          </div>
          <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:28, fontWeight:900, color:"var(--text)", letterSpacing:"-0.5px", marginBottom:6 }}>
            Campaign Intelligence Engine
          </h1>
          <p style={{ color:"var(--muted)", fontSize:14 }}>
            يحلل بيانات Meta + Snapchat + سلة ويولد قرارات بالذكاء الاصطناعي
          </p>
        </div>

        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"flex-end" }}>
          {metaAccounts.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <span style={{ fontSize:10, color:"var(--muted)", fontWeight:700, textTransform:"uppercase" }}>حساب Meta</span>
              <select value={metaAccId} onChange={e=>setMetaAccId(e.target.value)}>
                {metaAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          {snapAccounts.length > 0 && (
            <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
              <span style={{ fontSize:10, color:"var(--muted)", fontWeight:700, textTransform:"uppercase" }}>حساب Snapchat</span>
              <select value={snapAccId} onChange={e=>setSnapAccId(e.target.value)}>
                {snapAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <span style={{ fontSize:10, color:"var(--muted)", fontWeight:700, textTransform:"uppercase" }}>الفترة</span>
            <select value={datePreset} onChange={e=>setDatePreset(e.target.value)}>
              {DATE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button
            onClick={analyze}
            disabled={loading}
            style={{ background: loading ? "var(--glass-2)" : "linear-gradient(135deg, var(--primary), #4f46e5)", color:"#fff", border:"none", padding:"12px 22px", borderRadius:14, fontWeight:800, fontSize:14, cursor: loading ? "not-allowed" : "pointer", fontFamily:"inherit", boxShadow: loading ? "none" : "0 0 24px rgba(99,102,241,0.3)", display:"flex", alignItems:"center", gap:8, transition:"all 0.2s" }}
          >
            {loading ? (
              <>
                <span style={{ animation:"spin 1s linear infinite", display:"inline-block" }}>⟳</span>
                جاري التحليل...
              </>
            ) : (
              <>🧠 حلّل الآن</>
            )}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} } @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }`}</style>

      {error && (
        <div style={{ background:"rgba(244,63,94,0.08)", border:"1px solid rgba(244,63,94,0.25)", borderRadius:14, padding:"12px 16px", color:"#f43f5e", fontSize:13, fontWeight:700 }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Empty state ── */}
      {!result && !loading && (
        <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:20, padding:"60px 40px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
          <div style={{ fontSize:48, opacity:0.4 }}>🧠</div>
          <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:20, fontWeight:700, color:"var(--text)" }}>
            جاهز للتحليل
          </h2>
          <p style={{ color:"var(--muted)", fontSize:14, maxWidth:420, lineHeight:1.7 }}>
            اختر الحسابات والفترة الزمنية ثم اضغط "حلّل الآن" — سيجمع الـ Engine بيانات Meta وSnapchat وسلة ويولد تحليلاً ذكياً بالعربية خلال ثوانٍ.
          </p>
          <div style={{ display:"flex", gap:24, marginTop:8 }}>
            {[
              { icon:"📊", label:"Signal Engine", desc:"يكتشف المشاكل والفرص تلقائياً" },
              { icon:"🤖", label:"AI Analysis",   desc:"تحليل عميق بالذكاء الاصطناعي" },
              { icon:"⚡", label:"قرارات فورية",   desc:"SCALE / OPTIMIZE / PAUSE" },
            ].map(f=>(
              <div key={f.label} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, maxWidth:120 }}>
                <span style={{ fontSize:24 }}>{f.icon}</span>
                <span style={{ fontSize:12, fontWeight:700, color:"var(--text)" }}>{f.label}</span>
                <span style={{ fontSize:11, color:"var(--muted)", textAlign:"center" }}>{f.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:20, padding:"60px 40px", textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:16, animation:"spin 2s linear infinite", display:"inline-block" }}>🧠</div>
          <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:700, color:"var(--text)", marginBottom:8 }}>جاري تحليل البيانات...</h2>
          <p style={{ color:"var(--muted)", fontSize:13 }}>يجمع البيانات من Meta وSnapchat وسلة ثم يحللها بالذكاء الاصطناعي</p>
          <div style={{ display:"flex", justifyContent:"center", gap:8, marginTop:20 }}>
            {["جلب Meta...","جلب Snapchat...","جلب سلة...","توليد التحليل..."].map((s,i)=>(
              <div key={i} style={{ fontSize:11, color:"var(--muted)", background:"var(--glass)", border:"1px solid var(--border)", padding:"6px 12px", borderRadius:999 }}>{s}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && !loading && (
        <div style={{ display:"flex", flexDirection:"column", gap:16, animation:"fadeIn 0.4s ease-out" }}>

          {/* Signal summary badges */}
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
            {signalCounts.danger > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(244,63,94,0.1)", border:"1px solid rgba(244,63,94,0.25)", borderRadius:999, padding:"7px 14px" }}>
                <span style={{ fontSize:14 }}>🔴</span>
                <span style={{ fontSize:13, fontWeight:800, color:"#f43f5e" }}>{signalCounts.danger} مشكلة حرجة</span>
              </div>
            )}
            {signalCounts.warning > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.25)", borderRadius:999, padding:"7px 14px" }}>
                <span style={{ fontSize:14 }}>⚠️</span>
                <span style={{ fontSize:13, fontWeight:800, color:"#f59e0b" }}>{signalCounts.warning} تحذير</span>
              </div>
            )}
            {signalCounts.success > 0 && (
              <div style={{ display:"flex", alignItems:"center", gap:6, background:"rgba(6,214,160,0.1)", border:"1px solid rgba(6,214,160,0.25)", borderRadius:999, padding:"7px 14px" }}>
                <span style={{ fontSize:14 }}>✅</span>
                <span style={{ fontSize:13, fontWeight:800, color:"#06d6a0" }}>{signalCounts.success} فرصة إيجابية</span>
              </div>
            )}
            <div style={{ marginRight:"auto", fontSize:12, color:"var(--muted)" }}>
              {DATE_OPTIONS.find(d=>d.value===datePreset)?.label} • تم التحليل الآن
            </div>
          </div>

          {/* KPI Strip */}
          <KPIStrip meta={result.meta} snap={result.snap} salla={result.salla} />

          {/* Tabs */}
          <div style={{ display:"flex", gap:4, background:"var(--card)", border:"1px solid var(--border)", borderRadius:14, padding:4 }}>
            {[
              { key:"signals",  label:"⚡ الإشارات",         count: result.signals.length },
              { key:"analysis", label:"🧠 تحليل الذكاء الاصطناعي", count: null },
            ].map(tab=>(
              <button key={tab.key} onClick={()=>setActiveTab(tab.key)} style={{ flex:1, padding:"10px", borderRadius:10, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight: activeTab===tab.key ? 800 : 500, background: activeTab===tab.key ? "var(--card-2)" : "transparent", color: activeTab===tab.key ? "var(--text)" : "var(--muted)", borderBottom: activeTab===tab.key ? "2px solid var(--primary)" : "2px solid transparent", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                {tab.label}
                {tab.count !== null && (
                  <span style={{ background:"var(--primary)", color:"#fff", fontSize:10, fontWeight:900, padding:"2px 7px", borderRadius:999 }}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Signals Tab */}
          {activeTab === "signals" && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {result.signals.length === 0 ? (
                <div style={{ textAlign:"center", padding:"40px", color:"var(--muted)" }}>لا توجد إشارات كافية — تأكد من اتصال الحسابات وتوفر البيانات</div>
              ) : (
                result.signals.map((s,i) => <SignalCard key={i} signal={s} />)
              )}
            </div>
          )}

          {/* Analysis Tab */}
          {activeTab === "analysis" && (
            <div style={{ background:"var(--card)", border:"1px solid var(--border)", borderRadius:20, padding:"28px 32px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20, paddingBottom:16, borderBottom:"1px solid var(--border)" }}>
                <span style={{ fontSize:24 }}>🧠</span>
                <div>
                  <div style={{ fontSize:16, fontWeight:800, color:"var(--text)", fontFamily:"'Space Grotesk',sans-serif" }}>تحليل الذكاء الاصطناعي</div>
                  <div style={{ fontSize:12, color:"var(--muted)" }}>توليد Claude AI • Senior Performance Marketer</div>
                </div>
              </div>
              {result.ai_error ? (
                <div style={{ background:"rgba(244,63,94,0.08)", border:"1px solid rgba(244,63,94,0.25)", borderRadius:14, padding:"16px 18px", color:"#f43f5e", fontSize:13, lineHeight:1.7 }}>
                  ⚠ تعذّر توليد التحليل: {result.ai_error}
                </div>
              ) : (
                <AnalysisRenderer text={result.analysis} />
              )}
            </div>
          )}

        </div>
      )}

    </main>
  );
}
