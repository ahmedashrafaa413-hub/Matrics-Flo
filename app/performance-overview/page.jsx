"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";

const DATE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7d", label: "Last 7 Days" },
  { value: "last_30d", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
  { value: "last_90d", label: "Last 90 Days" },
  { value: "maximum", label: "Maximum" }
];

const fmt = {
  money: (v) => `$${Number(v || 0).toFixed(2)}`,
  number: (v) => Number(v || 0).toLocaleString(),
  x: (v) => `${Number(v || 0).toFixed(2)}x`
};

function roasColor(value) {
  const roas = Number(value || 0);

  if (roas >= 5) return "#06d6a0";
  if (roas >= 2) return "#f59e0b";
  return "#ff477e";
}

function KPICard({ label, value, icon, color }) {
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
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 22,
          color: "var(--text)"
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function SourceIcon({ source }) {
  const s = String(source || "").toLowerCase();

  let icon = "📊";
  let color = "#8b95c9";

  if (s.includes("meta")) {
    icon = "ⓕ";
    color = "#1877f2";
  }

  if (s.includes("snapchat")) {
    icon = "👻";
    color = "#fffc00";
  }

  if (s.includes("google")) {
    icon = "G";
    color = "#34a853";
  }

  if (s.includes("tiktok")) {
    icon = "♪";
    color = "#ff477e";
  }

  if (s.includes("salla")) {
    icon = "س";
    color = "#8b5cf6";
  }

  if (s.includes("total")) {
    icon = "Σ";
    color = "#06d6a0";
  }

  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: `${color}22`,
        color,
        fontWeight: 900,
        fontSize: 12
      }}
    >
      {icon}
    </span>
  );
}

export default function PerformanceOverviewPage() {
  const [datePreset, setDatePreset] = useState("last_30d");
  const [metaAccountId, setMetaAccountId] = useState("");
  const [snapchatAccountId, setSnapchatAccountId] = useState("");
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedMeta = getSetting("primary_meta_account", "");
    const savedSnap = getSetting("primary_snapchat_account", "");

    setMetaAccountId(savedMeta);
    setSnapchatAccountId(savedSnap);
  }, []);

  useEffect(() => {
    loadData();
  }, [datePreset, metaAccountId, snapchatAccountId]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      params.set("date_preset", datePreset);

      if (metaAccountId) {
        params.set("meta_account_id", metaAccountId);
      }

      if (snapchatAccountId) {
        params.set("snapchat_account_id", snapchatAccountId);
      }

      const result = await apiGet(`/api/performance/overview?${params.toString()}`);

      setData(result);
    } catch (err) {
      setData(null);
      setError(err.message || "Failed to load performance overview");
    } finally {
      setLoading(false);
    }
  }

  function handleMetaChange(value) {
    setMetaAccountId(value);
    saveSetting("primary_meta_account", value);
  }

  function handleSnapChange(value) {
    setSnapchatAccountId(value);
    saveSetting("primary_snapchat_account", value);
  }

  const summary = data?.summary || {};
  const sources = data?.sources || [];

  const filteredSources = useMemo(() => {
    if (activeTab === "ads") {
      return sources.filter((row) => row.type === "ads" || row.type === "total");
    }

    if (activeTab === "organic") {
      return sources.filter((row) => row.type === "organic" || row.type === "total");
    }

    return sources;
  }, [sources, activeTab]);

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <div>
          <h1
            style={{
              color: "var(--text)",
              fontSize: 24,
              fontWeight: 900,
              marginBottom: 4
            }}
          >
            Performance Overview
          </h1>

          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            Unified real ROAS from connected ad platforms and Salla sales.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={metaAccountId}
            onChange={(event) => handleMetaChange(event.target.value)}
            placeholder="Meta Account ID"
            style={{
              minWidth: 170,
              background: "var(--card)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "9px 12px"
            }}
          />

          <input
            value={snapchatAccountId}
            onChange={(event) => handleSnapChange(event.target.value)}
            placeholder="Snapchat Account ID"
            style={{
              minWidth: 220,
              background: "var(--card)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "9px 12px"
            }}
          />

          <select
            value={datePreset}
            onChange={(event) => setDatePreset(event.target.value)}
            disabled={loading}
          >
            {DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button className="dash-refresh" onClick={loadData} disabled={loading}>
            {loading ? "Loading..." : "↺ Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="dash-message error">⚠ {error}</div>}

      {data?.note && (
        <div className="dash-message warning">⚠ {data.note}</div>
      )}

      <div className="dash-kpi-grid">
        <KPICard
          label="Total Sales"
          value={loading ? "—" : fmt.money(summary.total_sales)}
          color="#06d6a0"
          icon="📦"
        />

        <KPICard
          label="Total Ads Sales"
          value={loading ? "—" : fmt.money(summary.total_ads_sales)}
          color="#38bdf8"
          icon="📣"
        />

        <KPICard
          label="Organic / Other Sales"
          value={loading ? "—" : fmt.money(summary.total_organic_sales)}
          color="#8b5cf6"
          icon="🌱"
        />

        <KPICard
          label="Total Ads Spend"
          value={loading ? "—" : fmt.money(summary.total_ads_spend)}
          color="#f59e0b"
          icon="💳"
        />

        <KPICard
          label="Actual ROAS"
          value={loading ? "—" : fmt.x(summary.actual_roas)}
          color={roasColor(summary.actual_roas)}
          icon="📈"
        />

        <KPICard
          label="Cost Per Purchase"
          value={loading ? "—" : fmt.money(summary.cost_per_purchase)}
          color="#ff477e"
          icon="🎯"
        />
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 8
        }}
      >
        {[
          { key: "all", label: "All" },
          { key: "ads", label: "Ads" },
          { key: "organic", label: "Organic / Other" }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              border: "none",
              background: "transparent",
              color: activeTab === tab.key ? "var(--text)" : "var(--muted)",
              fontWeight: 900,
              cursor: "pointer",
              padding: "8px 4px",
              borderBottom:
                activeTab === tab.key
                  ? "2px solid #ffcc00"
                  : "2px solid transparent"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="dash-table-card">
        <div className="dash-table-head">
          <div>
            <h2>Sources Performance</h2>
            <p>
              {loading
                ? "Loading..."
                : `${filteredSources.length} sources • unified spend and real sales`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="dash-empty">
            <h3>⏳ Loading performance data...</h3>
          </div>
        ) : filteredSources.length === 0 ? (
          <div className="dash-empty">
            <h3>No sources found</h3>
          </div>
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Spend</th>
                  <th>Clicks</th>
                  <th>Purchases</th>
                  <th>Cost Per Purchase</th>
                  <th>Sales</th>
                  <th>ROAS</th>
                </tr>
              </thead>

              <tbody>
                {filteredSources.map((row) => (
                  <tr
                    key={row.source}
                    style={{
                      fontWeight: row.source === "Total" ? 900 : 600,
                      borderTop:
                        row.source === "Total"
                          ? "1px solid var(--border-2)"
                          : undefined
                    }}
                  >
                    <td className="dash-name-cell">
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 10
                        }}
                      >
                        <SourceIcon source={row.source} />
                        {row.source}
                      </span>
                    </td>

                    <td>{fmt.money(row.spend)}</td>
                    <td>{fmt.number(row.clicks)}</td>
                    <td>{fmt.number(row.purchases)}</td>
                    <td>{fmt.money(row.cost_per_purchase)}</td>
                    <td>{fmt.money(row.sales)}</td>
                    <td style={{ color: roasColor(row.roas), fontWeight: 900 }}>
                      {fmt.x(row.roas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data?.debug?.length > 0 && (
        <div className="dash-table-card">
          <div className="dash-table-head">
            <div>
              <h2>Data Sources Status</h2>
              <p>Connection and API health</p>
            </div>
          </div>

          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Error</th>
                </tr>
              </thead>

              <tbody>
                {data.debug.map((row) => (
                  <tr key={row.source}>
                    <td>{row.source}</td>
                    <td>{row.success ? "Connected" : "Issue"}</td>
                    <td>{row.error || "—"}</td>
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
