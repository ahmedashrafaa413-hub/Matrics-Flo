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

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active Only" },
  { value: "paused", label: "Paused Only" }
];

const fmt = {
  money: (v) => `$${Number(v || 0).toFixed(2)}`,
  number: (v) => Number(v || 0).toLocaleString(),
  percent: (v) => `${Number(v || 0).toFixed(2)}%`,
  x: (v) => `${Number(v || 0).toFixed(2)}x`,
  compact: (v) => {
    const n = Number(v || 0);
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
  }
};

function ctrColor(value) {
  const ctr = Number(value || 0);

  if (ctr >= 1) return "var(--accent)";
  if (ctr >= 0.5) return "var(--gold)";
  return "var(--red)";
}

function roasColor(value) {
  const roas = Number(value || 0);

  if (roas >= 3) return "var(--accent)";
  if (roas >= 1) return "var(--gold)";
  return "var(--red)";
}

function getRowName(row) {
  return (
    row.ad_name ||
    row.adsquad_name ||
    row.campaign_name ||
    row.name ||
    "Unnamed"
  );
}

function getStatusRank(status) {
  const st = String(status || "").toUpperCase();

  if (st === "ACTIVE") return 1;
  if (st === "PENDING") return 2;
  if (st === "PAUSED") return 3;

  return 4;
}

function getSortValue(row, key) {
  if (key === "name") return getRowName(row);
  if (key === "status") return getStatusRank(row.status);
  if (key === "revenue") return Number(row.revenue || row.purchase_value || 0);
  if (key === "swipes") return Number(row.swipes || row.clicks || 0);

  return Number(row[key] || 0);
}

function SortIcon({ active, direction }) {
  if (!active) return <span style={{ opacity: 0.35 }}>↕</span>;

  return <span>{direction === "asc" ? "↑" : "↓"}</span>;
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

function filterRowsByStatus(rows, statusFilter) {
  if (statusFilter === "active") {
    return rows.filter((row) => String(row.status || "").toUpperCase() === "ACTIVE");
  }

  if (statusFilter === "paused") {
    return rows.filter((row) => String(row.status || "").toUpperCase() === "PAUSED");
  }

  return rows;
}

function SnapTable({ title, loading, rows, meta }) {
  const [sortKey, setSortKey] = useState("status");
  const [sortDirection, setSortDirection] = useState("asc");
  const [statusFilter, setStatusFilter] = useState("all");

  function handleSort(key) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);

    if (key === "name" || key === "status") {
      setSortDirection("asc");
    } else {
      setSortDirection("desc");
    }
  }

  const filteredRows = useMemo(() => {
    return filterRowsByStatus(rows, statusFilter);
  }, [rows, statusFilter]);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const statusDiff = getStatusRank(a.status) - getStatusRank(b.status);

      if (statusDiff !== 0) return statusDiff;

      const aValue = getSortValue(a, sortKey);
      const bValue = getSortValue(b, sortKey);

      if (typeof aValue === "string" || typeof bValue === "string") {
        const result = String(aValue).localeCompare(String(bValue));
        return sortDirection === "asc" ? result : -result;
      }

      const result = Number(aValue || 0) - Number(bValue || 0);
      return sortDirection === "asc" ? result : -result;
    });
  }, [filteredRows, sortKey, sortDirection]);

  const columns = [
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "spend", label: "Spend" },
    { key: "revenue", label: "Revenue" },
    { key: "roas", label: "ROAS" },
    { key: "purchases", label: "Purchases" },
    { key: "cpa", label: "CPA" },
    { key: "impressions", label: "Impressions" },
    { key: "swipes", label: "Swipes" },
    { key: "ctr", label: "CTR" },
    { key: "cpc", label: "CPC" },
    { key: "cpm", label: "CPM" },
    { key: "video_views", label: "Video Views" }
  ];

  return (
    <div className="dash-table-card">
      <div className="dash-table-head">
        <div>
          <h2>{title}</h2>
          <p>
            {loading
              ? "Loading..."
              : `${sortedRows.length} shown • ${rows.length} loaded • ${
                  meta?.total_entities_available || rows.length
                } available`}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatusFilter(filter.value)}
              style={{
                border: "1px solid var(--border)",
                background:
                  statusFilter === filter.value ? "var(--card-2)" : "transparent",
                color: statusFilter === filter.value ? "var(--text)" : "var(--muted)",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 11,
                fontWeight: 800,
                cursor: "pointer"
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {meta?.partial_data && (
        <div className="dash-message warning">
          ⚠ Partial live data: loaded {meta.count} of{" "}
          {meta.total_entities_available}. Active items are prioritized first.
        </div>
      )}

      {meta?.rate_limited && (
        <div className="dash-message error">
          ⚠ Snapchat rate limit reached. Wait a few minutes before refreshing.
        </div>
      )}

      {loading ? (
        <div className="dash-empty">
          <h3>⏳ Loading...</h3>
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="dash-empty">
          <h3>No data found</h3>
        </div>
      ) : (
        <div className="dash-table-scroll">
          <table className="dash-data-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key}>
                    <button
                      onClick={() => handleSort(column.key)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "inherit",
                        font: "inherit",
                        fontWeight: 800,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em"
                      }}
                    >
                      {column.label}
                      <SortIcon
                        active={sortKey === column.key}
                        direction={sortDirection}
                      />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {sortedRows.map((row, index) => (
                <tr key={row.id || index}>
                  <td className="dash-name-cell">{getRowName(row)}</td>

                  <td>
                    <StatusDot status={row.status} />
                  </td>

                  <td>{fmt.money(row.spend)}</td>

                  <td>{fmt.money(row.revenue || row.purchase_value)}</td>

                  <td style={{ color: roasColor(row.roas), fontWeight: 700 }}>
                    {fmt.x(row.roas)}
                  </td>

                  <td>{fmt.number(row.purchases)}</td>

                  <td>{fmt.money(row.cpa)}</td>

                  <td>{fmt.compact(row.impressions)}</td>

                  <td>{fmt.compact(row.swipes || row.clicks)}</td>

                  <td style={{ color: ctrColor(row.ctr), fontWeight: 700 }}>
                    {fmt.percent(row.ctr)}
                  </td>

                  <td>{fmt.money(row.cpc)}</td>

                  <td>{fmt.money(row.cpm)}</td>

                  <td>{fmt.compact(row.video_views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SnapchatPage() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [datePreset, setDatePreset] = useState("last_30d");

  const [campRows, setCampRows] = useState([]);
  const [campSummary, setCampSummary] = useState(null);
  const [campMeta, setCampMeta] = useState(null);
  const [campLoading, setCampLoading] = useState(false);

  const [adsquadRows, setAdsquadRows] = useState([]);
  const [adsquadMeta, setAdsquadMeta] = useState(null);
  const [adsquadLoaded, setAdsquadLoaded] = useState(false);
  const [adsquadLoading, setAdsquadLoading] = useState(false);

  const [adRows, setAdRows] = useState([]);
  const [adMeta, setAdMeta] = useState(null);
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
    setCampMeta(null);

    setAdsquadRows([]);
    setAdsquadMeta(null);
    setAdsquadLoaded(false);

    setAdRows([]);
    setAdMeta(null);
    setAdLoaded(false);

    setError("");

    campaignsRequestRef.current = "";
    adsquadsRequestRef.current = "";
    adsRequestRef.current = "";
  }

  function buildDateParam() {
    return `date_preset=${datePreset}&limit=20`;
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

  function createMeta(data) {
    return {
      count: data.count,
      total_entities_available: data.total_entities_available,
      loaded_limit: data.loaded_limit,
      partial_data: data.partial_data,
      rate_limited: data.rate_limited,
      version: data.version
    };
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
      setCampMeta(createMeta(data));
    } catch (err) {
      setCampRows([]);
      setCampSummary(null);
      setCampMeta(null);
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
      setAdsquadMeta(createMeta(data));
      setAdsquadLoaded(true);
    } catch (err) {
      setAdsquadRows([]);
      setAdsquadMeta(null);
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
      setAdMeta(createMeta(data));
      setAdLoaded(true);
    } catch (err) {
      setAdRows([]);
      setAdMeta(null);
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
    setCampMeta(null);

    setAdsquadRows([]);
    setAdsquadMeta(null);
    setAdsquadLoaded(false);

    setAdRows([]);
    setAdMeta(null);
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
        name: (row.name || row.campaign_name || "Unknown").slice(0, 14),
        spend: Number(row.spend || 0),
        revenue: Number(row.revenue || 0),
        swipes: Number(row.swipes || row.clicks || 0)
      })),
    [campRows]
  );

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

      {campMeta?.partial_data && activeTab === "overview" && (
        <div className="dash-message warning">
          ⚠ Live data is partial: loaded {campMeta.count} of{" "}
          {campMeta.total_entities_available}. Active items are prioritized.
        </div>
      )}

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
              label="Revenue"
              value={campLoading ? "—" : fmt.money(totals.revenue)}
              color="#06d6a0"
              icon="💵"
            />
            <KPICard
              label="ROAS"
              value={campLoading ? "—" : fmt.x(totals.roas)}
              color={roasColor(totals.roas)}
              icon="📈"
            />
            <KPICard
              label="Purchases"
              value={campLoading ? "—" : fmt.number(totals.purchases)}
              color="#22c55e"
              icon="🛒"
            />
            <KPICard
              label="CPA"
              value={campLoading ? "—" : fmt.money(totals.cpa)}
              color="#f59e0b"
              icon="🎯"
            />
            <KPICard
              label="Swipes"
              value={
                campLoading ? "—" : fmt.compact(totals.swipes || totals.clicks)
              }
              color="#8b5cf6"
              icon="👆"
            />
            <KPICard
              label="Impressions"
              value={campLoading ? "—" : fmt.compact(totals.impressions)}
              color="#6366f1"
              icon="👁"
            />
            <KPICard
              label="CTR"
              value={campLoading ? "—" : fmt.percent(totals.ctr)}
              color="#06d6a0"
              icon="📊"
            />
            <KPICard
              label="CPC"
              value={campLoading ? "—" : fmt.money(totals.cpc)}
              color="#f59e0b"
              icon="💳"
            />
            <KPICard
              label="CPM"
              value={campLoading ? "—" : fmt.money(totals.cpm)}
              color="#22c55e"
              icon="📡"
            />
            <KPICard
              label="Video Views"
              value={campLoading ? "—" : fmt.compact(totals.video_views)}
              color="#38bdf8"
              icon="🎥"
            />
            <KPICard
              label="Video View Rate"
              value={campLoading ? "—" : fmt.percent(totals.video_view_rate)}
              color="#38bdf8"
              icon="▶️"
            />
          </div>

          <div className="dash-chart-card">
            <div className="dash-chart-head">
              <div>
                <h2>Spend vs Revenue vs Swipes</h2>
                <p>Top loaded campaigns</p>
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
                      dataKey="revenue"
                      name="Revenue"
                      fill="#06d6a0"
                      radius={[5, 5, 0, 0]}
                    />
                    <Bar
                      dataKey="swipes"
                      name="Swipes"
                      fill="#8b5cf6"
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
          meta={campMeta}
        />
      )}

      {activeTab === "adsquads" && (
        <SnapTable
          title="Ad Squads"
          loading={adsquadLoading}
          rows={adsquadRows}
          meta={adsquadMeta}
        />
      )}

      {activeTab === "ads" && (
        <SnapTable title="Ads" loading={adLoading} rows={adRows} meta={adMeta} />
      )}
    </main>
  );
}
