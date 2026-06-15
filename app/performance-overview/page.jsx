"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";

const DATE_OPTIONS = [
  { value: "today",      label: "اليوم" },
  { value: "yesterday",  label: "أمس" },
  { value: "last_7d",    label: "آخر 7 أيام" },
  { value: "last_30d",   label: "آخر 30 يوم" },
  { value: "this_month", label: "هذا الشهر" },
  { value: "last_90d",   label: "آخر 90 يوم" },
  { value: "maximum",    label: "الكل" },
];

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmt = {
  sar:    (v) => `${Number(v || 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ﷼`,
  num:    (v) => Number(v || 0).toLocaleString("ar-SA"),
  x:      (v) => `${Number(v || 0).toFixed(2)}x`,
  pct:    (v) => `${Number(v || 0).toFixed(1)}%`,
};

function roasColor(v) {
  const r = Number(v || 0);
  if (r >= 5) return "#06d6a0";
  if (r >= 2) return "#f59e0b";
  return "#ff477e";
}

// ── KPI Card ───────────────────────────────────────────────────────────────────
function KPICard({ label, value, icon, color, sub }) {
  return (
    <div className="dash-kpi-card" style={{ position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "20px 20px 0 0" }} />
      <div className="dash-kpi-top">
        <span className="dash-kpi-label">{label}</span>
        <span className="dash-kpi-icon">{icon}</span>
      </div>
      <strong style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22, color: "var(--text)" }}>
        {value}
      </strong>
      {sub && <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, display: "block" }}>{sub}</span>}
    </div>
  );
}

// ── Source Icon ────────────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  const s = String(source || "").toLowerCase();
  const cfg =
    s.includes("meta")     ? { icon: "ⓕ", color: "#1877f2" } :
    s.includes("snapchat") ? { icon: "👻", color: "#fffc00" } :
    s.includes("google")   ? { icon: "G",  color: "#34a853" } :
    s.includes("tiktok")   ? { icon: "♪",  color: "#ff477e" } :
    s.includes("salla")    ? { icon: "س",  color: "#8b5cf6" } :
    s.includes("total")    ? { icon: "Σ",  color: "#06d6a0" } :
                             { icon: "📊", color: "#8b95c9" };
  return (
    <span style={{
      width: 26, height: 26, borderRadius: 999,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: `${cfg.color}22`, color: cfg.color, fontWeight: 900, fontSize: 13,
    }}>
      {cfg.icon}
    </span>
  );
}

// ── Winner Badge ───────────────────────────────────────────────────────────────
function WinnerBadge({ label, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: "2px 8px",
      borderRadius: 999, background: `${color}22`, color, border: `1px solid ${color}44`,
      marginRight: 6, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

// ── Stats Bar (Funnel visual) ──────────────────────────────────────────────────
function StatBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: "var(--text)", fontWeight: 700 }}>{fmt.num(value)}</span>
      </div>
      <div style={{ height: 4, background: "var(--border)", borderRadius: 99 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

// ── Account Selector ──────────────────────────────────────────────────────────
function AccountSelect({ label, icon, accounts, value, onChange, loading }) {
  if (!accounts || accounts.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>{icon} {label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} disabled={loading}
        style={{ minWidth: 160, fontSize: 12 }}>
        {accounts.map(a => (
          <option key={a.id} value={a.id}>{a.name} — {a.currency || ""}</option>
        ))}
      </select>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PerformanceOverviewPage() {
  const [datePreset, setDatePreset]           = useState("last_30d");
  const [metaAccountId, setMetaAccountId]     = useState("");
  const [snapAccountId, setSnapAccountId]     = useState("");
  const [metaAccounts, setMetaAccounts]       = useState([]);
  const [snapAccounts, setSnapAccounts]       = useState([]);
  const [data, setData]                       = useState(null);
  const [activeTab, setActiveTab]             = useState("all");
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState("");

  // Load account lists + saved selections
  useEffect(() => {
    const savedMeta = getSetting("primary_meta_account", "");
    const savedSnap = getSetting("primary_snapchat_account", "");
    if (savedMeta) setMetaAccountId(savedMeta);
    if (savedSnap) setSnapAccountId(savedSnap);

    // Fetch Meta accounts
    fetch("/api/meta/accounts", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const list = d.data || [];
        setMetaAccounts(list);
        if (!savedMeta && list.length > 0) {
          setMetaAccountId(list[0].id);
          saveSetting("primary_meta_account", list[0].id);
        }
      }).catch(() => {});

    // Fetch Snapchat accounts
    fetch("/api/snapchat/accounts", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const list = d.data || [];
        setSnapAccounts(list);
        if (!savedSnap && list.length > 0) {
          setSnapAccountId(list[0].id);
          saveSetting("primary_snapchat_account", list[0].id);
        }
      }).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [datePreset, metaAccountId, snapAccountId]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ date_preset: datePreset });
      if (metaAccountId)  params.set("meta_account_id", metaAccountId);
      if (snapAccountId)  params.set("snapchat_account_id", snapAccountId);
      const result = await apiGet(`/api/performance/overview?${params.toString()}`);
      setData(result);
    } catch (err) {
      setData(null);
      setError(err.message || "فشل تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }

  function handleMetaChange(val) {
    setMetaAccountId(val);
    saveSetting("primary_meta_account", val);
  }
  function handleSnapChange(val) {
    setSnapAccountId(val);
    saveSetting("primary_snapchat_account", val);
  }

  const summary = data?.summary || {};
  const sources = data?.sources || [];

  // Filtered sources by tab
  const filteredSources = useMemo(() => {
    const rows = sources.filter(r => r.source !== "Total");
    if (activeTab === "ads")     return rows.filter(r => r.type === "ads");
    if (activeTab === "organic") return rows.filter(r => r.type === "organic");
    return rows;
  }, [sources, activeTab]);

  const totalRow = sources.find(r => r.source === "Total");

  // ── Winner detection ────────────────────────────────────────────────────────
  const winners = useMemo(() => {
    const adSources = sources.filter(r => r.type === "ads" && r.spend > 0);
    if (adSources.length === 0) return {};
    const byROAS     = [...adSources].sort((a, b) => b.roas - a.roas)[0];
    const byOrders   = [...adSources].sort((a, b) => b.purchases - a.purchases)[0];
    const byRevenue  = [...adSources].sort((a, b) => b.sales - a.sales)[0];
    const byEfficiency = [...adSources].sort((a, b) => a.cost_per_purchase - b.cost_per_purchase)[0];
    return {
      roas:       byROAS?.source,
      orders:     byOrders?.source,
      revenue:    byRevenue?.source,
      efficiency: byEfficiency?.source,
    };
  }, [sources]);

  // ── Funnel data for stats bars ──────────────────────────────────────────────
  const maxClicks    = Math.max(...sources.filter(r => r.type === "ads").map(r => r.clicks || 0), 1);
  const maxPurchases = Math.max(...sources.filter(r => r.type === "ads").map(r => r.purchases || 0), 1);

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ color: "var(--text)", fontSize: 22, fontWeight: 900, marginBottom: 4 }}>
            📊 نظرة عامة على الأداء
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 12 }}>
            ROAS الفعلي = مبيعات سلة ÷ إجمالي الإنفاق الإعلاني — كل الأرقام بالريال السعودي
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <AccountSelect
            label="حساب Meta"
            icon="ⓕ"
            accounts={metaAccounts}
            value={metaAccountId}
            onChange={handleMetaChange}
            loading={loading}
          />
          <AccountSelect
            label="حساب Snapchat"
            icon="👻"
            accounts={snapAccounts}
            value={snapAccountId}
            onChange={handleSnapChange}
            loading={loading}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>📅 الفترة</span>
            <select value={datePreset} onChange={e => setDatePreset(e.target.value)} disabled={loading}>
              {DATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button className="dash-refresh" onClick={loadData} disabled={loading}>
            {loading ? "جاري التحميل..." : "↺ تحديث"}
          </button>
        </div>
      </div>

      {error && <div className="dash-message error">⚠ {error}</div>}

      {/* ── KPI Cards ── */}
      <div className="dash-kpi-grid">
        <KPICard label="إجمالي المبيعات" value={loading ? "—" : fmt.sar(summary.total_sales)}
          color="#06d6a0" icon="📦" sub="سلة — كل المصادر" />
        <KPICard label="مبيعات الإعلانات" value={loading ? "—" : fmt.sar(summary.total_ads_sales)}
          color="#38bdf8" icon="📣" sub="مبيعات منسوبة للإعلانات" />
        <KPICard label="مبيعات عضوية / أخرى" value={loading ? "—" : fmt.sar(summary.total_organic_sales)}
          color="#8b5cf6" icon="🌱" sub="مبيعات بدون إعلانات" />
        <KPICard label="إجمالي الإنفاق" value={loading ? "—" : fmt.sar(summary.total_ads_spend)}
          color="#f59e0b" icon="💳" sub="Meta + Snapchat" />
        <KPICard label="ROAS الفعلي" value={loading ? "—" : fmt.x(summary.actual_roas)}
          color={roasColor(summary.actual_roas)} icon="📈"
          sub="مبيعات سلة ÷ إنفاق إعلاني" />
        <KPICard label="تكلفة الشراء" value={loading ? "—" : fmt.sar(summary.cost_per_purchase)}
          color="#ff477e" icon="🎯" sub="إنفاق ÷ عدد الطلبات" />
      </div>

      {/* ── Winner Cards ── */}
      {!loading && sources.some(r => r.type === "ads" && r.spend > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {[
            { label: "أعلى ROAS", key: "roas",       icon: "🏆", color: "#06d6a0" },
            { label: "أكثر طلبات", key: "orders",    icon: "🛒", color: "#38bdf8" },
            { label: "أعلى إيراد",  key: "revenue",  icon: "💵", color: "#f59e0b" },
            { label: "أكفأ CPA",    key: "efficiency",icon: "⚡", color: "#8b5cf6" },
          ].map(w => {
            const src = sources.find(r => r.source === winners[w.key]);
            if (!src) return null;
            return (
              <div key={w.key} style={{
                background: "var(--card)", border: `1px solid ${w.color}33`,
                borderRadius: 14, padding: "14px 16px",
                borderTop: `3px solid ${w.color}`,
              }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>
                  {w.icon} {w.label}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <SourceBadge source={src.source} />
                  <span style={{ fontWeight: 800, color: "var(--text)", fontSize: 14 }}>{src.source}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>ROAS</div>
                    <div style={{ fontWeight: 800, color: roasColor(src.roas) }}>{fmt.x(src.roas)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>الطلبات</div>
                    <div style={{ fontWeight: 800, color: "var(--text)" }}>{fmt.num(src.purchases)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>المبيعات</div>
                    <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 12 }}>{fmt.sar(src.sales)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>CPA</div>
                    <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 12 }}>{fmt.sar(src.cost_per_purchase)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Sources Table ── */}
      <div className="dash-table-card">
        <div className="dash-table-head">
          <div>
            <h2>أداء المصادر</h2>
            <p>{loading ? "جاري التحميل..." : `${filteredSources.length} مصدر • موحد بالريال السعودي`}</p>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { key: "all",     label: "الكل" },
              { key: "ads",     label: "إعلانات" },
              { key: "organic", label: "عضوي" },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                border: "none", cursor: "pointer", padding: "6px 14px", borderRadius: 8,
                fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                background: activeTab === tab.key ? "var(--card-2)" : "transparent",
                color: activeTab === tab.key ? "var(--text)" : "var(--muted)",
                borderBottom: activeTab === tab.key ? "2px solid #ffcc00" : "2px solid transparent",
              }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="dash-empty"><h3>⏳ جاري التحميل...</h3></div>
        ) : filteredSources.length === 0 ? (
          <div className="dash-empty"><h3>لا توجد بيانات</h3></div>
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead>
                <tr>
                  <th>المصدر</th>
                  <th>الإنفاق ﷼</th>
                  <th>الكليكات</th>
                  <th>الطلبات</th>
                  <th>تكلفة الشراء ﷼</th>
                  <th>المبيعات ﷼</th>
                  <th>ROAS</th>
                  <th>نسبة المبيعات</th>
                </tr>
              </thead>
              <tbody>
                {filteredSources.map(row => {
                  const totalSales = summary.total_sales || 1;
                  const sharePct = totalSales > 0 ? (row.sales / totalSales) * 100 : 0;
                  return (
                    <tr key={row.source}>
                      <td className="dash-name-cell">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <SourceBadge source={row.source} />
                          <span>{row.source}</span>
                          {winners.roas     === row.source && <WinnerBadge label="🏆 أعلى ROAS"    color="#06d6a0" />}
                          {winners.orders   === row.source && <WinnerBadge label="🛒 أكثر طلبات"   color="#38bdf8" />}
                          {winners.revenue  === row.source && <WinnerBadge label="💵 أعلى إيراد"   color="#f59e0b" />}
                        </span>
                      </td>
                      <td>{fmt.sar(row.spend)}</td>
                      <td>{fmt.num(row.clicks)}</td>
                      <td>{fmt.num(row.purchases)}</td>
                      <td>{row.cost_per_purchase > 0 ? fmt.sar(row.cost_per_purchase) : "—"}</td>
                      <td style={{ fontWeight: 700 }}>{fmt.sar(row.sales)}</td>
                      <td style={{ color: roasColor(row.roas), fontWeight: 900 }}>{fmt.x(row.roas)}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 99, minWidth: 60 }}>
                            <div style={{ height: "100%", width: `${Math.min(sharePct, 100)}%`, background: "#6557ff", borderRadius: 99 }} />
                          </div>
                          <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 36 }}>{fmt.pct(sharePct)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Total Row */}
              {totalRow && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 900 }}>
                    <td className="dash-name-cell">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <SourceBadge source="total" />
                        <span style={{ color: "#06d6a0" }}>الإجمالي</span>
                      </span>
                    </td>
                    <td style={{ color: "#f59e0b" }}>{fmt.sar(totalRow.spend)}</td>
                    <td>{fmt.num(totalRow.clicks)}</td>
                    <td style={{ color: "#38bdf8" }}>{fmt.num(totalRow.purchases)}</td>
                    <td>{totalRow.cost_per_purchase > 0 ? fmt.sar(totalRow.cost_per_purchase) : "—"}</td>
                    <td style={{ color: "#06d6a0" }}>{fmt.sar(totalRow.sales)}</td>
                    <td style={{ color: roasColor(totalRow.roas) }}>{fmt.x(totalRow.roas)}</td>
                    <td>100%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* ── Funnel Comparison ── */}
      {!loading && sources.some(r => r.type === "ads" && r.spend > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {sources.filter(r => r.type === "ads" && r.spend > 0).map(src => (
            <div key={src.source} style={{
              background: "var(--card)", border: "1px solid var(--border)",
              borderRadius: 14, padding: "16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <SourceBadge source={src.source} />
                <span style={{ fontWeight: 800, color: "var(--text)" }}>{src.source}</span>
                <span style={{ marginRight: "auto", fontWeight: 900, color: roasColor(src.roas) }}>{fmt.x(src.roas)}</span>
              </div>
              <StatBar label="الكليكات"  value={src.clicks}    max={maxClicks}    color="#6557ff" />
              <StatBar label="الطلبات"   value={src.purchases} max={maxPurchases} color="#06d6a0" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: "var(--muted)" }}>الإنفاق</div>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{fmt.sar(src.spend)}</div>
                </div>
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: "var(--muted)" }}>المبيعات</div>
                  <div style={{ fontWeight: 700, color: "#06d6a0" }}>{fmt.sar(src.sales)}</div>
                </div>
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: "var(--muted)" }}>CPA</div>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{fmt.sar(src.cost_per_purchase)}</div>
                </div>
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: "var(--muted)" }}>CVR</div>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>
                    {fmt.pct(src.clicks > 0 ? (src.purchases / src.clicks) * 100 : 0)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Debug / Data Sources Status ── */}
      {data?.debug?.length > 0 && (
        <div className="dash-table-card">
          <div className="dash-table-head">
            <div>
              <h2>حالة مصادر البيانات</h2>
              <p>اتصال وصحة الـ API</p>
            </div>
          </div>
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead>
                <tr><th>المصدر</th><th>الحالة</th><th>الخطأ</th></tr>
              </thead>
              <tbody>
                {data.debug.map(row => (
                  <tr key={row.source}>
                    <td>{row.source}</td>
                    <td style={{ color: row.success ? "#06d6a0" : "#ff477e", fontWeight: 700 }}>
                      {row.success ? "✅ متصل" : "❌ مشكلة"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{row.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </main>
  );
}
