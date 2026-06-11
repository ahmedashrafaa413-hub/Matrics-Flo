"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";

const SNAP_COLOR = "#FFFC00";
const SNAP_DARK = "#E6E300";

const DATE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7d", label: "Last 7 Days" },
  { value: "last_30d", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
  { value: "last_90d", label: "Last 90 Days" },
  { value: "maximum", label: "Maximum" }
];

const TABS = [
  { key: "overview", label: "Overview", icon: "⬡" },
  { key: "campaigns", label: "Campaigns", icon: "◈" },
  { key: "adsquads", label: "Ad Squads", icon: "◫" },
  { key: "ads", label: "Ads", icon: "▣" }
];

const CREATIVE_FILTERS = [
  { key: "all", label: "All" },
  { key: "winner", label: "Potential Winners" },
  { key: "problem", label: "Problems" },
  { key: "no_swipes", label: "No Swipes" },
  { key: "high_cpc", label: "High CPC" }
];

const fmt = {
  money: (v) => `$${Number(v || 0).toFixed(2)}`,
  number: (v) => Number(v || 0).toLocaleString(),
  percent: (v) => `${Number(v || 0).toFixed(2)}%`,
  compact: (v) => {
    const n = Number(v || 0);
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  }
};

function safeDivide(a, b) {
  const x = Number(a || 0);
  const y = Number(b || 0);

  if (!y) return 0;

  return x / y;
}

function ctrColor(value) {
  const ctr = Number(value || 0);

  if (ctr >= 1) return "var(--accent)";
  if (ctr >= 0.5) return "var(--gold)";

  return "var(--red)";
}

function diagnoseSnapCreative(row) {
  const spend = Number(row.spend || 0);
  const impressions = Number(row.impressions || 0);
  const swipes = Number(row.swipes || row.clicks || 0);
  const ctr = Number(row.ctr || 0);
  const cpc = Number(row.cpc || 0);

  if (spend > 0 && impressions > 1000 && swipes === 0) {
    return {
      label: "Traffic Issue",
      severity: "high",
      badge: "🚫 No Swipes",
      problem: "The ad is spending but generating no swipes.",
      action:
        "Check targeting, placement, bid strategy, ad approval, and creative clarity."
    };
  }

  if (impressions > 1000 && ctr < 0.5) {
    return {
      label: "Creative Problem",
      severity: "high",
      badge: "🎬 Creative Issue",
      problem: "CTR is weak, which means the creative is not driving enough interest.",
      action:
        "Test a stronger hook, clearer first frame, UGC opening, sharper offer, or bolder visual."
    };
  }

  if (cpc > 1 && spend > 0) {
    return {
      label: "High CPC",
      severity: "medium",
      badge: "💸 High CPC",
      problem: "Swipe cost is high compared to current engagement.",
      action:
        "Improve CTR, test broader audiences, refresh creative angles, and reduce friction in the CTA."
    };
  }

  if (ctr >= 1 && spend > 0 && swipes > 0) {
    return {
      label: "Potential Winner",
      severity: "success",
      badge: "🏆 Potential Winner",
      problem: "This ad is generating healthy swipe engagement.",
      action:
        "Keep monitoring. Test a gradual budget increase and create 3 variations from the same angle."
    };
  }

  return {
    label: "Monitor",
    severity: "neutral",
    badge: "⚪ Monitor",
    problem: "No strong issue or winning signal detected yet.",
    action: "Keep collecting data before making a major decision."
  };
}

function getDiagnosisColor(severity) {
  if (severity === "success") return "#06d6a0";
  if (severity === "high") return "#ff477e";
  if (severity === "medium") return "#f59e0b";

  return "#8b95c9";
}

function StatusDot({ status }) {
  if (!status) return null;

  const st = String(status).toUpperCase();

  const cfg =
    st === "ACTIVE"
      ? { color: "#06d6a0", label: "Active" }
      : st === "PAUSED"
      ? { color: "#f59e0b", label: "Paused" }
      : st === "PENDING"
      ? { color: "#6366f1", label: "Pending" }
      : { color: "#7b88b8", label: status };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        color: cfg.color,
        background: `${cfg.color}12`,
        border: `1px solid ${cfg.color}25`,
        whiteSpace: "nowrap"
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: cfg.color
        }}
      />
      {cfg.label}
    </span>
  );
}

function KPICard({ label, value, color, icon }) {
  return (
    <div className="dash-kpi-card" style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: color,
          borderRadius: "20px 20px 0 0"
        }}
      />

      <div className="dash-kpi-top">
        <span className="dash-kpi-label">{label}</span>
        <span className="dash-kpi-icon">{icon}</span>
      </div>

      <strong
        style={{
          fontFamily: "'Space Grotesk',sans-serif",
          fontSize: 22,
          color: "var(--text)"
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function CreativeMetric({ label, value, color }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.035)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "9px 10px",
        minHeight: 58
      }}
    >
      <div
        style={{
          color: "var(--muted)",
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: "0.8px",
          textTransform: "uppercase",
          marginBottom: 6
        }}
      >
        {label}
      </div>

      <strong
        style={{
          color: color || "var(--text)",
          fontSize: 15,
          fontWeight: 800,
          fontFamily: "'Space Grotesk',sans-serif"
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function SnapCreativeCard({ row }) {
  const diagnosis = diagnoseSnapCreative(row);
  const diagnosisColor = getDiagnosisColor(diagnosis.severity);

  return (
    <article
      style={{
        background:
          "linear-gradient(180deg,rgba(18,24,48,0.96),rgba(12,16,34,0.98))",
        border: `1px solid ${diagnosisColor}55`,
        borderRadius: 22,
        overflow: "hidden",
        boxShadow: `0 18px 50px ${diagnosisColor}12`
      }}
    >
      <div
        style={{
          height: 150,
          background:
            "radial-gradient(circle at 50% 20%,rgba(255,252,0,0.18),transparent 42%), linear-gradient(135deg,rgba(255,252,0,0.08),rgba(99,102,241,0.08))",
          borderBottom: "1px solid var(--border)",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 18,
            background: "rgba(255,252,0,0.16)",
            border: "1px solid rgba(255,252,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32
          }}
        >
          👻
        </div>

        <div style={{ position: "absolute", top: 12, left: 12 }}>
          <StatusDot status={row.status} />
        </div>

        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "rgba(0,0,0,0.5)",
            color: SNAP_COLOR,
            border: "1px solid rgba(255,252,0,0.35)",
            borderRadius: 999,
            padding: "4px 8px",
            fontSize: 10,
            fontWeight: 800
          }}
        >
          Snapchat Ad
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <h3
          style={{
            color: "var(--text)",
            fontSize: 14,
            fontWeight: 800,
            marginBottom: 5,
            lineHeight: 1.35
          }}
        >
          {row.ad_name || row.name || "Unnamed Ad"}
        </h3>

        <p
          style={{
            color: "var(--muted)",
            fontSize: 11,
            lineHeight: 1.5,
            minHeight: 34
          }}
        >
          {row.campaign_name || "Campaign"}
          {row.adsquad_name ? ` • ${row.adsquad_name}` : ""}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 8,
            marginTop: 14
          }}
        >
          <CreativeMetric label="Spend" value={fmt.money(row.spend)} />
          <CreativeMetric
            label="Impressions"
            value={fmt.compact(row.impressions)}
          />
          <CreativeMetric label="Swipes" value={fmt.compact(row.swipes)} />
          <CreativeMetric
            label="CTR"
            value={fmt.percent(row.ctr)}
            color={ctrColor(row.ctr)}
          />
          <CreativeMetric label="CPC" value={fmt.money(row.cpc)} />
          <CreativeMetric label="CPM" value={fmt.money(row.cpm)} />
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 16,
            background: `${diagnosisColor}12`,
            border: `1px solid ${diagnosisColor}35`
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 8
            }}
          >
            <strong
              style={{
                color: diagnosisColor,
                fontSize: 12,
                fontWeight: 900
              }}
            >
              {diagnosis.badge}
            </strong>

            <span
              style={{
                color: diagnosisColor,
                fontSize: 10,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.6px"
              }}
            >
              {diagnosis.label}
            </span>
          </div>

          <p
            style={{
              color: "var(--text)",
              fontSize: 11,
              lineHeight: 1.45,
              marginBottom: 6
            }}
          >
            <strong>Problem:</strong> {diagnosis.problem}
          </p>

          <p
            style={{
              color: "var(--muted)",
              fontSize: 11,
              lineHeight: 1.45
            }}
          >
            <strong style={{ color: "var(--text)" }}>Action:</strong>{" "}
            {diagnosis.action}
          </p>
        </div>
      </div>
    </article>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "10px 14px"
      }}
    >
      <p style={{ color: "var(--muted)", fontSize: 11, marginBottom: 6 }}>
        {label}
      </p>

      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontWeight: 700, fontSize: 12 }}>
          {p.name}: {Number(p.value || 0).toLocaleString()}
        </p>
      ))}
    </div>
  );
}

export default function SnapchatPage() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [datePreset, setDatePreset] = useState("last_30d");
  const [creativeFilter, setCreativeFilter] = useState("all");

  const [campRows, setCampRows] = useState([]);
  const [campSummary, setCampSummary] = useState(null);
  const [campLoading, setCampLoading] = useState(false);

  const [adsquadRows, setAdsquadRows] = useState([]);
  const [adsquadLoaded, setAdsquadLoaded] = useState(false);
  const [adsquadLoading, setAdsquadLoading] = useState(false);

  const [adRows, setAdRows] = useState([]);
  const [adLoaded, setAdLoaded] = useState(false);
  const [adLoading, setAdLoading] = useState(false);

  const [connected, setConnected] = useState(true);
  const [error, setError] = useState("");

  const campaignsRequestRef = useRef("");
  const adsquadsRequestRef = useRef("");
  const adsRequestRef = useRef("");
  const lastManualRefreshRef = useRef(0);

  const isAnyLoading = campLoading || adsquadLoading || adLoading;

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!accountId) return;

    resetData();
    loadCampaigns(accountId);
  }, [accountId, datePreset]);

  useEffect(() => {
    if (!accountId) return;

    if (activeTab === "adsquads" && !adsquadLoaded && !adsquadLoading) {
      loadAdsquads(accountId);
    }

    if (activeTab === "ads" && !adLoaded && !adLoading) {
      loadAds(accountId);
    }
  }, [activeTab, accountId, adsquadLoaded, adLoaded, adsquadLoading, adLoading]);

  function resetData() {
    setCampRows([]);
    setCampSummary(null);
    setAdsquadRows([]);
    setAdsquadLoaded(false);
    setAdRows([]);
    setAdLoaded(false);
    setError("");

    campaignsRequestRef.current = "";
    adsquadsRequestRef.current = "";
    adsRequestRef.current = "";
  }

  function buildDateParam() {
    return `date_preset=${datePreset}`;
  }

  async function loadAccounts() {
    try {
      setError("");

      const data = await apiGet("/api/snapchat/accounts");

      if (!data.success) {
        setConnected(false);
        return;
      }

      const list = data.data || [];

      setAccounts(list);

      const saved = getSetting("primary_snapchat_account", "");
      const selected =
        list.find((account) => account.id === saved)?.id || list[0]?.id || "";

      setAccountId(selected);

      if (selected) {
        saveSetting("primary_snapchat_account", selected);
      }

      setConnected(true);
    } catch (err) {
      setConnected(false);
      setError(err.message || "Failed to load Snapchat accounts");
    }
  }

  async function loadCampaigns(selectedAccount = accountId) {
    if (!selectedAccount || campLoading) return;

    const key = `${selectedAccount}|campaign|${buildDateParam()}`;

    if (campaignsRequestRef.current === key) return;

    campaignsRequestRef.current = key;
    setCampLoading(true);
    setError("");

    try {
      const data = await apiGet(
        `/api/snapchat/insights?account_id=${selectedAccount}&level=campaign&${buildDateParam()}`
      );

      setCampRows(data.data || []);
      setCampSummary(data.summary || null);
    } catch (err) {
      setCampRows([]);
      setCampSummary(null);
      setError(err.message || "Failed to load Snapchat campaigns");
      campaignsRequestRef.current = "";
    } finally {
      setCampLoading(false);
    }
  }

  async function loadAdsquads(selectedAccount = accountId) {
    if (!selectedAccount || adsquadLoading) return;

    const key = `${selectedAccount}|adsquad|${buildDateParam()}`;

    if (adsquadsRequestRef.current === key) return;

    adsquadsRequestRef.current = key;
    setAdsquadLoading(true);
    setError("");

    try {
      const data = await apiGet(
        `/api/snapchat/insights?account_id=${selectedAccount}&level=adsquad&${buildDateParam()}`
      );

      setAdsquadRows(data.data || []);
      setAdsquadLoaded(true);
    } catch (err) {
      setAdsquadRows([]);
      setAdsquadLoaded(false);
      setError(err.message || "Failed to load Snapchat ad squads");
      adsquadsRequestRef.current = "";
    } finally {
      setAdsquadLoading(false);
    }
  }

  async function loadAds(selectedAccount = accountId) {
    if (!selectedAccount || adLoading) return;

    const key = `${selectedAccount}|ad|${buildDateParam()}`;

    if (adsRequestRef.current === key) return;

    adsRequestRef.current = key;
    setAdLoading(true);
    setError("");

    try {
      const data = await apiGet(
        `/api/snapchat/insights?account_id=${selectedAccount}&level=ad&${buildDateParam()}`
      );

      setAdRows(data.data || []);
      setAdLoaded(true);
    } catch (err) {
      setAdRows([]);
      setAdLoaded(false);
      setError(err.message || "Failed to load Snapchat ads");
      adsRequestRef.current = "";
    } finally {
      setAdLoading(false);
    }
  }

  async function refresh() {
    if (isAnyLoading) return;

    const now = Date.now();

    if (now - lastManualRefreshRef.current < 60000) {
      setError("Please wait 60 seconds before refreshing Snapchat data again.");
      return;
    }

    lastManualRefreshRef.current = now;

    campaignsRequestRef.current = "";
    adsquadsRequestRef.current = "";
    adsRequestRef.current = "";

    setCampRows([]);
    setCampSummary(null);
    setAdsquadRows([]);
    setAdsquadLoaded(false);
    setAdRows([]);
    setAdLoaded(false);
    setError("");

    await loadCampaigns(accountId);

    if (activeTab === "adsquads") {
      await loadAdsquads(accountId);
    }

    if (activeTab === "ads") {
      await loadAds(accountId);
    }
  }

  function handleAccountChange(value) {
    setAccountId(value);
    saveSetting("primary_snapchat_account", value);
  }

  const totals = campSummary || {};

  const chartData = useMemo(
    () =>
      campRows.slice(0, 8).map((row) => ({
        name: (row.name || "Unknown").slice(0, 14),
        spend: Number(row.spend || 0),
        swipes: Number(row.swipes || 0)
      })),
    [campRows]
  );

  const creativeRows = useMemo(() => {
    const filtered = adRows.filter((row) => {
      const diagnosis = diagnoseSnapCreative(row);

      if (creativeFilter === "all") return true;
      if (creativeFilter === "winner") return diagnosis.label === "Potential Winner";
      if (creativeFilter === "problem") {
        return ["Creative Problem", "Traffic Issue"].includes(diagnosis.label);
      }
      if (creativeFilter === "no_swipes") {
        return Number(row.spend || 0) > 0 && Number(row.swipes || 0) === 0;
      }
      if (creativeFilter === "high_cpc") return diagnosis.label === "High CPC";

      return true;
    });

    return filtered.sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
  }, [adRows, creativeFilter]);

  const creativeSummary = useMemo(() => {
    const total = adRows.reduce(
      (acc, row) => {
        acc.spend += Number(row.spend || 0);
        acc.impressions += Number(row.impressions || 0);
        acc.swipes += Number(row.swipes || 0);

        const diagnosis = diagnoseSnapCreative(row);

        if (diagnosis.label === "Potential Winner") acc.winners += 1;
        if (["Creative Problem", "Traffic Issue", "High CPC"].includes(diagnosis.label)) {
          acc.problems += 1;
        }

        return acc;
      },
      {
        spend: 0,
        impressions: 0,
        swipes: 0,
        winners: 0,
        problems: 0
      }
    );

    return {
      ...total,
      ctr: safeDivide(total.swipes, total.impressions) * 100,
      cpc: safeDivide(total.spend, total.swipes),
      cpm: safeDivide(total.spend, total.impressions) * 1000
    };
  }, [adRows]);

  if (!connected) {
    return (
      <main
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 300,
          gap: 16
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "rgba(255,252,0,0.1)",
            border: "1px solid rgba(255,252,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26
          }}
        >
          👻
        </div>

        <h1 style={{ color: "var(--text)" }}>Snapchat not connected</h1>

        <a
          href="/api/snapchat/auth"
          style={{
            background: "linear-gradient(135deg,#FFFC00,#E6E300)",
            color: "#000",
            padding: "11px 24px",
            borderRadius: "var(--radius-md)",
            fontWeight: 700,
            fontSize: 13,
            textDecoration: "none"
          }}
        >
          Connect Snapchat →
        </a>
      </main>
    );
  }

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "rgba(255,252,0,0.12)",
              border: "1px solid rgba(255,252,0,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18
            }}
          >
            👻
          </div>

          <div>
            <h1 style={{ color: "var(--text)", fontSize: 20 }}>
              Snapchat Ads
            </h1>

            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              {accounts.find((account) => account.id === accountId)?.name ||
                "No account selected"}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {accounts.length > 0 && (
            <select
              value={accountId}
              onChange={(event) => handleAccountChange(event.target.value)}
              disabled={isAnyLoading}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} — {account.currency}
                </option>
              ))}
            </select>
          )}

          <select
            value={datePreset}
            onChange={(event) => setDatePreset(event.target.value)}
            disabled={isAnyLoading}
          >
            {DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            className="dash-refresh"
            onClick={refresh}
            disabled={isAnyLoading}
          >
            {isAnyLoading ? "Loading..." : "↺ Refresh"}
          </button>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 4
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: "var(--radius-md)",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12,
              fontWeight: activeTab === tab.key ? 700 : 500,
              background:
                activeTab === tab.key ? "var(--card-2)" : "transparent",
              color: activeTab === tab.key ? "var(--text)" : "var(--muted)",
              borderBottom:
                activeTab === tab.key
                  ? "2px solid #FFFC00"
                  : "2px solid transparent"
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="dash-message error">⚠ {error}</div>}

      {activeTab === "overview" && (
        <>
          <div className="dash-kpi-grid">
            <KPICard
              label="Spend"
              value={campLoading ? "—" : fmt.money(totals.spend)}
              color={SNAP_DARK}
              icon="💰"
            />
            <KPICard
              label="Impressions"
              value={campLoading ? "—" : fmt.compact(totals.impressions)}
              color="#6366f1"
              icon="👁"
            />
            <KPICard
              label="Swipes"
              value={campLoading ? "—" : fmt.compact(totals.swipes || totals.clicks)}
              color="#8b5cf6"
              icon="👆"
            />
            <KPICard
              label="CTR"
              value={campLoading ? "—" : fmt.percent(totals.ctr)}
              color="#06d6a0"
              icon="📈"
            />
            <KPICard
              label="CPC"
              value={campLoading ? "—" : fmt.money(totals.cpc)}
              color="#f59e0b"
              icon="🎯"
            />
            <KPICard
              label="CPM"
              value={campLoading ? "—" : fmt.money(totals.cpm)}
              color="#22c55e"
              icon="📊"
            />
          </div>

          <div className="dash-chart-card">
            <div className="dash-chart-head">
              <div>
                <h2>Spend vs Swipes</h2>
                <p>Top campaigns</p>
              </div>
            </div>

            <div className="dash-chart-box">
              {chartData.length === 0 ? (
                <div className="dash-empty">
                  <h3>{campLoading ? "⏳ Loading..." : "No data"}</h3>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barGap={3}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      stroke="var(--muted)"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="var(--muted)"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<ChartTip />} />
                    <Bar
                      dataKey="spend"
                      name="Spend"
                      fill={SNAP_DARK}
                      radius={[5, 5, 0, 0]}
                    />
                    <Bar
                      dataKey="swipes"
                      name="Swipes"
                      fill="#06d6a0"
                      radius={[5, 5, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === "campaigns" && (
        <SnapTable
          title="Campaigns"
          loading={campLoading}
          rows={campRows}
          nameKey="name"
        />
      )}

      {activeTab === "adsquads" && (
        <SnapTable
          title="Ad Squads"
          loading={adsquadLoading}
          rows={adsquadRows}
          nameKey="name"
        />
      )}

      {activeTab === "ads" && (
        <>
          <div className="dash-kpi-grid">
            <KPICard
              label="Ads Spend"
              value={adLoading ? "—" : fmt.money(creativeSummary.spend)}
              color={SNAP_DARK}
              icon="💰"
            />
            <KPICard
              label="Impressions"
              value={adLoading ? "—" : fmt.compact(creativeSummary.impressions)}
              color="#6366f1"
              icon="👁"
            />
            <KPICard
              label="Swipes"
              value={adLoading ? "—" : fmt.compact(creativeSummary.swipes)}
              color="#8b5cf6"
              icon="👆"
            />
            <KPICard
              label="Avg CTR"
              value={adLoading ? "—" : fmt.percent(creativeSummary.ctr)}
              color="#06d6a0"
              icon="📈"
            />
            <KPICard
              label="Winners"
              value={adLoading ? "—" : creativeSummary.winners}
              color="#22c55e"
              icon="🏆"
            />
            <KPICard
              label="Problems"
              value={adLoading ? "—" : creativeSummary.problems}
              color="#ff477e"
              icon="🔴"
            />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CREATIVE_FILTERS.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setCreativeFilter(filter.key)}
                style={{
                  border: "1px solid var(--border)",
                  background:
                    creativeFilter === filter.key
                      ? "var(--card-2)"
                      : "var(--card)",
                  color:
                    creativeFilter === filter.key ? "var(--text)" : "var(--muted)",
                  padding: "7px 12px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer"
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {adLoading ? (
            <div className="dash-empty">
              <h3>⏳ Loading Snapchat creatives...</h3>
            </div>
          ) : creativeRows.length === 0 ? (
            <div className="dash-empty">
              <h3>No ads found</h3>
            </div>
          ) : (
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
                gap: 16
              }}
            >
              {creativeRows.map((row, index) => (
                <SnapCreativeCard key={row.id || row.ad_id || index} row={row} />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function SnapTable({ title, loading, rows, nameKey }) {
  return (
    <div className="dash-table-card">
      <div className="dash-table-head">
        <div>
          <h2>{title}</h2>
          <p>{loading ? "Loading..." : `${rows.length} rows`}</p>
        </div>
      </div>

      {loading ? (
        <div className="dash-empty">
          <h3>⏳ Loading...</h3>
        </div>
      ) : rows.length === 0 ? (
        <div className="dash-empty">
          <h3>No data found</h3>
        </div>
      ) : (
        <div className="dash-table-scroll">
          <table className="dash-data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Spend</th>
                <th>Impressions</th>
                <th>Swipes</th>
                <th>CTR</th>
                <th>CPC</th>
                <th>CPM</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id || index}>
                  <td className="dash-name-cell">{row[nameKey] || row.name}</td>
                  <td>
                    <StatusDot status={row.status} />
                  </td>
                  <td>{fmt.money(row.spend)}</td>
                  <td>{fmt.compact(row.impressions)}</td>
                  <td>{fmt.compact(row.swipes)}</td>
                  <td style={{ color: ctrColor(row.ctr), fontWeight: 700 }}>
                    {fmt.percent(row.ctr)}
                  </td>
                  <td>{fmt.money(row.cpc)}</td>
                  <td>{fmt.money(row.cpm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
