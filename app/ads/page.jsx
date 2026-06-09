"use client";

import { useEffect, useState, useMemo } from "react";
import { apiGet } from "../../lib/api";
import { getSetting } from "../../lib/storage";
import { rankCreatives, scoringSummary } from "../../lib/creativeScoring";

function formatValue(value, type) {
  const num = Number(value || 0);
  if (type === "money")   return `$${num.toFixed(2)}`;
  if (type === "percent") return `${num.toFixed(2)}%`;
  if (type === "x")       return `${num.toFixed(2)}x`;
  return num.toLocaleString();
}

function ScoreBar({ score }) {
  const color = score >= 75 ? "#f59e0b"
              : score >= 55 ? "#06d6a0"
              : score >= 35 ? "#6366f1"
              : "#f43f5e";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1, height: 6, background: "rgba(255,255,255,0.06)",
        borderRadius: 3, overflow: "hidden"
      }}>
        <div style={{
          height: "100%", width: `${score}%`,
          background: color, borderRadius: 3,
          transition: "width 0.4s ease"
        }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color, minWidth: 28 }}>{score}</span>
    </div>
  );
}

function DecisionBadge({ decision, color, bg }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "4px 10px", borderRadius: 999,
      fontSize: 12, fontWeight: 700,
      color, background: bg,
      border: `1px solid ${color}40`,
      whiteSpace: "nowrap"
    }}>
      {decision}
    </span>
  );
}

function SummaryCard({ label, count, color, icon }) {
  return (
    <div style={{
      background: "var(--card)", backdropFilter: "blur(16px)",
      border: `1px solid ${color}30`,
      borderRadius: "var(--radius-lg)", padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 8
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.8px" }}>
          {label}
        </span>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <strong style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 32, fontWeight: 700, color }}>{count}</strong>
    </div>
  );
}

function StatusDot({ effectiveStatus }) {
  if (!effectiveStatus) return <span style={{ color: "var(--muted-2)", fontSize: 11 }}>—</span>;
  const st = effectiveStatus.toUpperCase();
  const cfg =
    st === "ACTIVE"          ? { color: "#06d6a0", label: "Active",        bg: "rgba(6,214,160,0.1)"   } :
    st === "PAUSED"          ? { color: "#f59e0b", label: "Paused",        bg: "rgba(245,158,11,0.1)"  } :
    st === "CAMPAIGN_PAUSED" ? { color: "#f59e0b", label: "Camp. Paused",  bg: "rgba(245,158,11,0.08)" } :
    st === "ADSET_PAUSED"    ? { color: "#f59e0b", label: "AdSet Paused",  bg: "rgba(245,158,11,0.08)" } :
    st === "ARCHIVED"        ? { color: "#6b7ba4", label: "Archived",      bg: "rgba(107,123,164,0.1)" } :
    st === "DISAPPROVED"     ? { color: "#f43f5e", label: "Disapproved",   bg: "rgba(244,63,94,0.1)"   } :
    st === "PENDING_REVIEW"  ? { color: "#6366f1", label: "In Review",     bg: "rgba(99,102,241,0.1)"  } :
                               { color: "#6b7ba4", label: effectiveStatus,  bg: "rgba(107,123,164,0.1)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}30`,
      whiteSpace: "nowrap"
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.color, flexShrink: 0,
        boxShadow: st === "ACTIVE" ? `0 0 6px ${cfg.color}` : "none" }} />
      {cfg.label}
    </span>
  );
}

export default function AdsPage() {
  const [accounts,       setAccounts]       = useState([]);
  const [accountId,      setAccountId]      = useState("");
  const [datePreset,     setDatePreset]     = useState("maximum");
  const [rows,           setRows]           = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState("");
  const [status,         setStatus]         = useState("");
  const [filterDecision, setFilterDecision] = useState("all");
  const [sortBy,         setSortBy]         = useState("score");
  const [expandedAd,     setExpandedAd]     = useState(null);
  const [statusMap,      setStatusMap]      = useState({});
  const [filterStatus,   setFilterStatus]   = useState("all");

  useEffect(() => { loadAccounts(); }, []);
  useEffect(() => { if (accountId) loadAds(); }, [accountId, datePreset]);

  async function loadAccounts() {
    try {
      const data = await apiGet("/api/meta/accounts");
      const list = data.data || [];
      setAccounts(list);
      const saved = getSetting("primary_meta_account", "");
      setAccountId(saved || list[0]?.id || "");
    } catch (e) { setError(e.message); }
  }

  async function loadAds() {
    if (!accountId) return;
    setLoading(true); setError("");
    setStatus("Loading ads...");
    try {
      const data = await apiGet(
        `/api/meta/insights?account_id=${accountId}&level=ad&date_preset=${datePreset}`
      );
      setRows(data.data || []);
      setStatus(`${data.data?.length || 0} ads loaded`);

      // جلب الـ statuses في الخلفية
      apiGet(`/api/meta/statuses?account_id=${accountId}&level=ad`)
        .then(s => setStatusMap(s.statusMap || {}))
        .catch(() => {});
    } catch (e) {
      setError(e.message);
      setStatus("Failed to load");
      setStatusMap({});
    } finally { setLoading(false); }
  }

  const ranked  = useMemo(() => rankCreatives(rows, "ad_name"), [rows]);
  const summary = useMemo(() => scoringSummary(ranked), [ranked]);

  const filtered = useMemo(() => {
    let list = [...ranked];
    if (filterDecision !== "all") {
      list = list.filter(r => r._scoring.decision.toLowerCase().startsWith(filterDecision.toLowerCase()));
    }
    if (filterStatus !== "all") {
      list = list.filter(r => {
        const st = (statusMap[r.ad_id || ""]?.effective_status || "").toUpperCase();
        if (filterStatus === "active") return st === "ACTIVE";
        if (filterStatus === "paused") return ["PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED"].includes(st);
        return true;
      });
    }
    if (sortBy === "score") list.sort((a,b) => b._scoring.score - a._scoring.score);
    if (sortBy === "spend") list.sort((a,b) => Number(b.spend||0)     - Number(a.spend||0));
    if (sortBy === "roas")  list.sort((a,b) => Number(b.roas||0)      - Number(a.roas||0));
    if (sortBy === "hook")  list.sort((a,b) => Number(b.hook_rate||0) - Number(a.hook_rate||0));
    return list;
  }, [ranked, filterDecision, filterStatus, sortBy, statusMap]);

  const DATE_OPTIONS = [
    { value: "maximum",   label: "Maximum"     },
    { value: "today",     label: "Today"       },
    { value: "yesterday", label: "Yesterday"   },
    { value: "last_7d",   label: "Last 7 Days" },
    { value: "last_30d",  label: "Last 30 Days"},
    { value: "this_month",label: "This Month"  },
  ];

  return (
    <main className="dash-pro">

      <header className="dash-pro-header">
        <div>
          <span className="dash-badge">Creative Intelligence</span>
          <h1>Ads Scoring</h1>
          <p>تشخيص تلقائي لكل إعلان — Winner / Scale / Test / Kill</p>
        </div>
        <div className="dash-header-actions">
          <select value={datePreset} onChange={e => setDatePreset(e.target.value)} style={{
            background: "var(--card)", color: "var(--text)",
            border: "1px solid var(--border-2)", borderRadius: "var(--radius-md)",
            padding: "10px 14px", fontSize: 13, fontWeight: 600,
            fontFamily: "inherit", cursor: "pointer", outline: "none"
          }}>
            {DATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="dash-refresh" onClick={loadAds} disabled={loading}>
            {loading ? "⏳" : "↺"} Refresh
          </button>
        </div>
      </header>

      {accounts.length > 0 && (
        <div className="dash-filter-grid" style={{ marginBottom: 16 }}>
          <div className="dash-filter-card">
            <label>Ad Account</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {a.currency}</option>)}
            </select>
          </div>
          <div className="dash-filter-card" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>Sort:</span>
            {["score","spend","roas","hook"].map(s => (
              <button key={s} onClick={() => setSortBy(s)} style={{
                padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                border: "1px solid var(--border-2)", cursor: "pointer", fontFamily: "inherit",
                background: sortBy === s ? "rgba(99,102,241,0.15)" : "transparent",
                color: sortBy === s ? "var(--primary)" : "var(--muted)"
              }}>{s}</button>
            ))}
          </div>
        </div>
      )}

      {(error || status) && (
        <div className={error ? "dash-message error" : "dash-message success"} style={{ marginBottom: 16 }}>
          {error ? `⚠ ${error}` : `✓ ${status}`}
        </div>
      )}

      {ranked.length > 0 && (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
          <SummaryCard label="Winners" count={summary.winners.length}  color="#f59e0b" icon="🏆" />
          <SummaryCard label="Scale"   count={summary.scalable.length} color="#06d6a0" icon="↑"  />
          <SummaryCard label="Test"    count={summary.tests.length}    color="#6366f1" icon="🧪" />
          <SummaryCard label="Kill"    count={summary.kills.length}    color="#f43f5e" icon="✕"  />
        </section>
      )}

      {ranked.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          {[
            { key: "all",    label: `All (${ranked.length})`,              color: "var(--muted)" },
            { key: "winner", label: `Winners (${summary.winners.length})`, color: "#f59e0b" },
            { key: "scale",  label: `Scale (${summary.scalable.length})`,  color: "#06d6a0" },
            { key: "test",   label: `Test (${summary.tests.length})`,      color: "#6366f1" },
            { key: "kill",   label: `Kill (${summary.kills.length})`,      color: "#f43f5e" },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterDecision(f.key)} style={{
              padding: "7px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700,
              border: `1px solid ${filterDecision === f.key ? f.color : "var(--border)"}`,
              background: filterDecision === f.key ? `${f.color}15` : "transparent",
              color: filterDecision === f.key ? f.color : "var(--muted)",
              cursor: "pointer", fontFamily: "inherit"
            }}>{f.label}</button>
          ))}
        </div>
      )}

      {Object.keys(statusMap).length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: "1px" }}>Status:</span>
          {[
            { key: "all",    label: "All",    color: "var(--muted)" },
            { key: "active", label: "🟢 Active",  color: "#06d6a0" },
            { key: "paused", label: "🟡 Paused",  color: "#f59e0b" },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterStatus(f.key)} style={{
              padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700,
              border: `1px solid ${filterStatus === f.key ? f.color : "var(--border)"}`,
              background: filterStatus === f.key ? `${f.color}15` : "transparent",
              color: filterStatus === f.key ? f.color : "var(--muted)",
              cursor: "pointer", fontFamily: "inherit"
            }}>{f.label}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="dash-empty"><h3>⏳ جاري تحليل الإعلانات...</h3></div>
      ) : filtered.length === 0 ? (
        <div className="dash-empty">
          <h3>لا توجد إعلانات</h3>
          <p>تأكد من ربط Meta وصحة الحساب.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((row, i) => {
            const s          = row._scoring;
            const isExpanded = expandedAd === i;
            return (
              <div key={i} style={{
                background: "var(--card)", backdropFilter: "blur(16px)",
                border: `1px solid ${isExpanded ? s.decisionColor + "40" : "var(--border)"}`,
                borderRadius: "var(--radius-xl)", overflow: "hidden", transition: "border-color 0.2s"
              }}>
                <div
                  onClick={() => setExpandedAd(isExpanded ? null : i)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 100px 80px 90px 90px 90px 90px 90px 120px 28px",
                    alignItems: "center", gap: 12, padding: "16px 20px", cursor: "pointer"
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row._name}
                    </div>
                    {s.diagnosis.primaryIssue && (
                      <div style={{ fontSize: 11, color: "var(--red)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        ⚠ {s.diagnosis.primaryIssue}
                      </div>
                    )}
                    {!s.diagnosis.primaryIssue && s.diagnosis.primaryWin && (
                      <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        ✓ {s.diagnosis.primaryWin}
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Status</div>
                    <StatusDot effectiveStatus={statusMap[row.ad_id || ""]?.effective_status} />
                  </div>

                  {[
                    { label: "Score", content: <ScoreBar score={s.score} /> },
                    { label: "Spend", content: <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{formatValue(row.spend, "money")}</div> },
                    { label: "ROAS",  content: <div style={{ fontSize: 13, fontWeight: 700, color: Number(row.roas||0) >= 2 ? "var(--accent)" : Number(row.roas||0) >= 1 ? "var(--gold)" : "var(--red)" }}>{formatValue(row.roas, "x")}</div> },
                    { label: "CTR",   content: <div style={{ fontSize: 13, fontWeight: 600, color: Number(row.ctr||0) >= 1 ? "var(--accent)" : Number(row.ctr||0) >= 0.5 ? "var(--gold)" : "var(--red)" }}>{formatValue(row.ctr, "percent")}</div> },
                    { label: "Hook",  content: <div style={{ fontSize: 13, fontWeight: 600, color: Number(row.hook_rate||0) >= 25 ? "var(--accent)" : "var(--text)" }}>{Number(row.hook_rate||0) > 0 ? formatValue(row.hook_rate, "percent") : "—"}</div> },
                    { label: "Hold",  content: <div style={{ fontSize: 13, fontWeight: 600, color: Number(row.hold_rate||0) >= 40 ? "var(--accent)" : "var(--text)" }}>{Number(row.hold_rate||0) > 0 ? formatValue(row.hold_rate, "percent") : "—"}</div> },
                  ].map(col => (
                    <div key={col.label}>
                      <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{col.label}</div>
                      {col.content}
                    </div>
                  ))}

                  <DecisionBadge decision={s.decision} color={s.decisionColor} bg={s.decisionBg} />
                  <div style={{ fontSize: 16, color: "var(--muted)", textAlign: "center", transition: "transform 0.2s", transform: isExpanded ? "rotate(180deg)" : "none" }}>▾</div>
                </div>

                {isExpanded && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: "20px 24px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>

                      {/* Score Breakdown */}
                      <div>
                        <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 }}>Score Breakdown</h4>
                        {[
                          { label: "Hook Strength",    val: s.scores.hook,    max: 20 },
                          { label: "Hold Rate",        val: s.scores.hold,    max: 15 },
                          { label: "CTR Quality",      val: s.scores.ctr,     max: 20 },
                          { label: "Conversion Power", val: s.scores.conv,    max: 25 },
                          { label: "Cost Efficiency",  val: s.scores.cost,    max: 15 },
                          { label: "Fatigue Penalty",  val: s.scores.fatigue, max: 0  },
                        ].map(item => (
                          <div key={item.label} style={{ marginBottom: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                              <span style={{ fontSize: 12, color: "var(--muted)" }}>{item.label}</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: item.val < 0 ? "var(--red)" : "var(--text)" }}>
                                {item.val > 0 ? "+" : ""}{item.val}{item.max > 0 ? `/${item.max}` : ""}
                              </span>
                            </div>
                            {item.max > 0 && (
                              <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${(item.val / item.max) * 100}%`, background: "var(--primary)", borderRadius: 2 }} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Full KPIs */}
                      <div>
                        <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 }}>Full Metrics</h4>
                        {[
                          { label: "Spend",       val: formatValue(row.spend, "money") },
                          { label: "Revenue",     val: formatValue(row.purchase_value, "money") },
                          { label: "Purchases",   val: formatValue(row.purchases, "number") },
                          { label: "CPA",         val: formatValue(row.cpa, "money") },
                          { label: "ATC",         val: formatValue(row.add_to_cart, "number") },
                          { label: "Impressions", val: formatValue(row.impressions, "number") },
                          { label: "Frequency",   val: Number(row.frequency||0).toFixed(2) },
                          { label: "CPM",         val: formatValue(row.cpm, "money") },
                          { label: "Hook Rate",   val: Number(row.hook_rate||0) > 0 ? formatValue(row.hook_rate, "percent") : "—" },
                          { label: "Hold Rate",   val: Number(row.hold_rate||0) > 0 ? formatValue(row.hold_rate, "percent") : "—" },
                          { label: "Completion",  val: Number(row.completion_rate||0) > 0 ? formatValue(row.completion_rate, "percent") : "—" },
                        ].map(m => (
                          <div key={m.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <span style={{ fontSize: 12, color: "var(--muted)" }}>{m.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{m.val}</span>
                          </div>
                        ))}
                      </div>

                      {/* Diagnosis */}
                      <div>
                        <h4 style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 12 }}>Diagnosis</h4>
                        {s.diagnosis.wins.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 6 }}>✓ Wins</div>
                            {s.diagnosis.wins.map((w, wi) => (
                              <div key={wi} style={{ fontSize: 12, color: "var(--accent)", padding: "4px 0", opacity: 0.85 }}>{w}</div>
                            ))}
                          </div>
                        )}
                        {s.diagnosis.issues.length > 0 && (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", marginBottom: 6 }}>⚠ Issues</div>
                            {s.diagnosis.issues.map((issue, ii) => (
                              <div key={ii} style={{
                                fontSize: 12, color: "var(--text-2)", padding: "6px 10px",
                                background: "rgba(244,63,94,0.06)", borderRadius: 8,
                                borderRight: "2px solid var(--red)", marginBottom: 6
                              }}>{issue}</div>
                            ))}
                          </div>
                        )}
                        {s.diagnosis.issues.length === 0 && s.diagnosis.wins.length === 0 && (
                          <p style={{ fontSize: 12, color: "var(--muted)" }}>بيانات غير كافية للتشخيص.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
