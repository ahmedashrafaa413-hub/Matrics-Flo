"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";

const SAR_RATE = 3.75;

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
  { key: "overview", label: "Overview", apiLevel: "overview" },
  { key: "campaigns", label: "Campaigns", apiLevel: "campaign" },
  { key: "adsquads", label: "Ad Squads", apiLevel: "adsquad" },
  { key: "ads", label: "Ads", apiLevel: "ad" },
  { key: "creative", label: "Creative", apiLevel: "ad" }
];

function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function toSAR(value) {
  return safeNumber(value) * SAR_RATE;
}

function formatNumber(value) {
  return safeNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
}

function formatMoneySAR(value) {
  return `SAR ${toSAR(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatMoneyUSD(value) {
  return `$${safeNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatPercent(value) {
  return `${safeNumber(value).toFixed(2)}%`;
}

function formatROAS(value) {
  return `${safeNumber(value).toFixed(2)}x`;
}

function buildQuery(params) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });

  return search.toString();
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => {
    const spend = safeNumber(row.spend);
    const revenue = safeNumber(row.revenue || row.purchase_value);
    const purchases = safeNumber(row.purchases);
    const impressions = safeNumber(row.impressions);
    const swipes = safeNumber(row.swipes || row.clicks);
    const videoViews = safeNumber(row.video_views);

    return {
      ...row,
      id: row.id || row.entity_id || row.account_id || row.name,
      name:
        row.name ||
        row.campaign_name ||
        row.adsquad_name ||
        row.ad_name ||
        row.entity_name ||
        "Unnamed",
      spend,
      revenue,
      purchase_value: revenue,
      purchases,
      impressions,
      swipes,
      clicks: swipes,
      video_views: videoViews,
      roas: spend ? revenue / spend : safeNumber(row.roas),
      cpa: purchases ? spend / purchases : safeNumber(row.cpa),
      ctr: impressions ? (swipes / impressions) * 100 : safeNumber(row.ctr),
      cpc: swipes ? spend / swipes : safeNumber(row.cpc),
      cpm: impressions ? (spend / impressions) * 1000 : safeNumber(row.cpm)
    };
  });
}

function normalizeSummary(summary) {
  const spend = safeNumber(summary?.spend);
  const revenue = safeNumber(summary?.revenue || summary?.purchase_value);
  const purchases = safeNumber(summary?.purchases);
  const impressions = safeNumber(summary?.impressions);
  const swipes = safeNumber(summary?.swipes || summary?.clicks);
  const videoViews = safeNumber(summary?.video_views);

  return {
    currency: summary?.currency || "USD",
    spend,
    revenue,
    purchase_value: revenue,
    purchases,
    impressions,
    swipes,
    clicks: swipes,
    video_views: videoViews,
    roas: spend ? revenue / spend : safeNumber(summary?.roas),
    cpa: purchases ? spend / purchases : safeNumber(summary?.cpa),
    ctr: impressions ? (swipes / impressions) * 100 : safeNumber(summary?.ctr),
    cpc: swipes ? spend / swipes : safeNumber(summary?.cpc),
    cpm: impressions ? (spend / impressions) * 1000 : safeNumber(summary?.cpm),
    video_view_rate: impressions
      ? (videoViews / impressions) * 100
      : safeNumber(summary?.video_view_rate)
  };
}

function getLevelFromTab(tab) {
  return TABS.find((item) => item.key === tab)?.apiLevel || "campaign";
}

function getTitleFromTab(tab) {
  return TABS.find((item) => item.key === tab)?.label || "Campaigns";
}

function StatusBadge({ status }) {
  const raw = String(status || "").toUpperCase();

  let color = "#8b95c9";
  let label = raw || "UNKNOWN";

  if (raw === "ACTIVE") {
    color = "#06d6a0";
    label = "ACTIVE";
  }

  if (raw === "PAUSED") {
    color = "#f59e0b";
    label = "PAUSED";
  }

  if (raw === "PENDING") {
    color = "#6366f1";
    label = "PENDING";
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        color,
        background: `${color}15`,
        border: `1px solid ${color}35`
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color
        }}
      />
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub, icon, color }) {
  return (
    <div
      className="dash-kpi-card"
      style={{
        position: "relative",
        minHeight: 126
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: color,
          borderRadius: "20px 20px 0 0"
        }}
      />

      <div className="dash-kpi-top">
        <span className="dash-kpi-label">{label}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>

      <strong
        style={{
          display: "block",
          marginTop: 10,
          fontSize: 24,
          color: "var(--text)",
          fontFamily: "'Space Grotesk', sans-serif"
        }}
      >
        {value}
      </strong>

      {sub ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--muted)"
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ title, description, actionLabel, onAction, loading }) {
  return (
    <div className="dash-empty" style={{ minHeight: 240 }}>
      <h3>{title}</h3>
      {description ? (
        <p style={{ maxWidth: 560, margin: "10px auto", lineHeight: 1.7 }}>
          {description}
        </p>
      ) : null}

      {actionLabel ? (
        <button
          onClick={onAction}
          disabled={loading}
          style={{
            marginTop: 16,
            padding: "11px 18px",
            borderRadius: 14,
            border: "1px solid rgba(255,252,0,0.35)",
            background: "rgba(255,252,0,0.12)",
            color: "#FFFC00",
            fontWeight: 900,
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Syncing..." : actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function DataTable({ title, rows, loading }) {
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState("desc");
  const [statusFilter, setStatusFilter] = useState("all");

  const sortedRows = useMemo(() => {
    let list = [...rows];

    if (statusFilter === "active") {
      list = list.filter((row) => String(row.status).toUpperCase() === "ACTIVE");
    }

    if (statusFilter === "paused") {
      list = list.filter((row) => String(row.status).toUpperCase() === "PAUSED");
    }

    list.sort((a, b) => {
      const av = safeNumber(a[sortKey]);
      const bv = safeNumber(b[sortKey]);
      return sortDir === "asc" ? av - bv : bv - av;
    });

    return list;
  }, [rows, sortKey, sortDir, statusFilter]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDir("desc");
  }

  function Th({ k, children }) {
    return (
      <th
        onClick={() => toggleSort(k)}
        style={{
          cursor: "pointer",
          whiteSpace: "nowrap",
          userSelect: "none"
        }}
      >
        {children}
        {sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  return (
    <div className="dash-table-card">
      <div className="dash-table-head">
        <div>
          <h2>{title}</h2>
          <p>{loading ? "Loading..." : `${sortedRows.length} rows from Supabase cache`}</p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { key: "all", label: "All" },
            { key: "active", label: "Active Only" },
            { key: "paused", label: "Paused Only" }
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setStatusFilter(item.key)}
              style={{
                padding: "7px 12px",
                borderRadius: 999,
                border:
                  statusFilter === item.key
                    ? "1px solid #FFFC00"
                    : "1px solid var(--border)",
                background:
                  statusFilter === item.key
                    ? "rgba(255,252,0,0.12)"
                    : "transparent",
                color: statusFilter === item.key ? "#FFFC00" : "var(--muted)",
                fontWeight: 800,
                fontSize: 12,
                cursor: "pointer"
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <EmptyState title="Loading cached data..." />
      ) : sortedRows.length === 0 ? (
        <EmptyState title="No rows in cache" description="Run Sync Now to load this level from Snapchat into Supabase." />
      ) : (
        <div className="dash-table-scroll">
          <table className="dash-data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <Th k="spend">Spend SAR</Th>
                <Th k="revenue">Revenue SAR</Th>
                <Th k="roas">ROAS</Th>
                <Th k="purchases">Purchases</Th>
                <Th k="cpa">CPA SAR</Th>
                <Th k="impressions">Impressions</Th>
                <Th k="swipes">Swipes</Th>
                <Th k="ctr">CTR</Th>
                <Th k="cpc">CPC SAR</Th>
                <Th k="cpm">CPM SAR</Th>
                <Th k="video_views">Video Views</Th>
              </tr>
            </thead>

            <tbody>
              {sortedRows.map((row, index) => (
                <tr key={row.id || index}>
                  <td className="dash-name-cell">{row.name}</td>
                  <td>
                    <StatusBadge status={row.status || row.raw?.status} />
                  </td>
                  <td>{formatMoneySAR(row.spend)}</td>
                  <td>{formatMoneySAR(row.revenue)}</td>
                  <td
                    style={{
                      fontWeight: 900,
                      color:
                        safeNumber(row.roas) >= 3
                          ? "#06d6a0"
                          : safeNumber(row.roas) >= 1
                            ? "#f59e0b"
                            : "#f43f5e"
                    }}
                  >
                    {formatROAS(row.roas)}
                  </td>
                  <td>{formatNumber(row.purchases)}</td>
                  <td>{formatMoneySAR(row.cpa)}</td>
                  <td>{formatNumber(row.impressions)}</td>
                  <td>{formatNumber(row.swipes)}</td>
                  <td>{formatPercent(row.ctr)}</td>
                  <td>{formatMoneySAR(row.cpc)}</td>
                  <td>{formatMoneySAR(row.cpm)}</td>
                  <td>{formatNumber(row.video_views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreativeView({ rows, loading }) {
  const creatives = useMemo(() => {
    const map = new Map();

    rows.forEach((row) => {
      const key = String(row.name || "Unnamed").trim().toLowerCase();

      if (!map.has(key)) {
        map.set(key, {
          id: row.id,
          name: row.name,
          status: row.status,
          spend: 0,
          revenue: 0,
          purchases: 0,
          impressions: 0,
          swipes: 0,
          video_views: 0,
          count: 0
        });
      }

      const item = map.get(key);

      item.spend += safeNumber(row.spend);
      item.revenue += safeNumber(row.revenue);
      item.purchases += safeNumber(row.purchases);
      item.impressions += safeNumber(row.impressions);
      item.swipes += safeNumber(row.swipes);
      item.video_views += safeNumber(row.video_views);
      item.count += 1;

      if (String(row.status).toUpperCase() === "ACTIVE") {
        item.status = "ACTIVE";
      }
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        roas: item.spend ? item.revenue / item.spend : 0,
        cpa: item.purchases ? item.spend / item.purchases : 0,
        ctr: item.impressions ? (item.swipes / item.impressions) * 100 : 0
      }))
      .sort((a, b) => safeNumber(b.spend) - safeNumber(a.spend));
  }, [rows]);

  if (loading) {
    return <EmptyState title="Loading creative cache..." />;
  }

  if (!creatives.length) {
    return (
      <EmptyState
        title="No creative data yet"
        description="Run Sync Now for Ads level first. The creative view uses cached Ads data from Supabase."
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12
        }}
      >
        <KpiCard
          label="Unique Creatives"
          value={formatNumber(creatives.length)}
          icon="🎬"
          color="#8b5cf6"
        />
        <KpiCard
          label="Creative Spend"
          value={formatMoneySAR(creatives.reduce((s, r) => s + safeNumber(r.spend), 0))}
          icon="💰"
          color="#FFFC00"
        />
        <KpiCard
          label="Creative Revenue"
          value={formatMoneySAR(creatives.reduce((s, r) => s + safeNumber(r.revenue), 0))}
          icon="💵"
          color="#06d6a0"
        />
        <KpiCard
          label="Creative Purchases"
          value={formatNumber(creatives.reduce((s, r) => s + safeNumber(r.purchases), 0))}
          icon="🛒"
          color="#38bdf8"
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14
        }}
      >
        {creatives.map((item) => {
          const isWinner = item.roas >= 3 && item.purchases > 0;
          const isLosing = item.spend > 50 && item.roas < 1;

          return (
            <div
              key={item.id || item.name}
              className="dash-kpi-card"
              style={{
                minHeight: 220,
                borderColor: isWinner
                  ? "rgba(6,214,160,0.35)"
                  : isLosing
                    ? "rgba(244,63,94,0.35)"
                    : "var(--border)"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <strong style={{ color: "var(--text)", fontSize: 14 }}>
                  {item.name}
                </strong>
                <StatusBadge status={item.status} />
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <MiniMetric label="Spend" value={formatMoneySAR(item.spend)} />
                <MiniMetric label="Revenue" value={formatMoneySAR(item.revenue)} />
                <MiniMetric label="ROAS" value={formatROAS(item.roas)} />
                <MiniMetric label="Purchases" value={formatNumber(item.purchases)} />
                <MiniMetric label="CTR" value={formatPercent(item.ctr)} />
                <MiniMetric label="Duplicates" value={`×${item.count}`} />
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 12,
                  background: isWinner
                    ? "rgba(6,214,160,0.09)"
                    : isLosing
                      ? "rgba(244,63,94,0.09)"
                      : "rgba(255,255,255,0.04)",
                  color: "var(--text-2)",
                  fontSize: 12,
                  lineHeight: 1.6
                }}
              >
                {isWinner
                  ? "Winner creative. Consider scaling budget and creating variations."
                  : isLosing
                    ? "Weak creative. Review hook, offer, or targeting before scaling."
                    : "Monitor until more data is available."}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)"
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "var(--muted)",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: 4
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 900 }}>
        {value}
      </div>
    </div>
  );
}

export default function SnapchatPage() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [datePreset, setDatePreset] = useState("maximum");
  const [activeTab, setActiveTab] = useState("overview");

  const [summary, setSummary] = useState(normalizeSummary({}));
  const [rows, setRows] = useState([]);

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [error, setError] = useState("");
  const [cacheInfo, setCacheInfo] = useState(null);

  const selectedAccount = useMemo(() => {
    return accounts.find((account) => account.id === accountId) || null;
  }, [accounts, accountId]);

  const currentLevel = getLevelFromTab(activeTab);

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!accountId) return;
    loadCachedData();
  }, [accountId, datePreset, activeTab]);

  async function loadAccounts() {
    setLoadingAccounts(true);
    setError("");

    try {
      const data = await apiGet("/api/snapchat/accounts");
      const list = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.accounts)
          ? data.accounts
          : [];

      const uniqueAccounts = Array.from(
        new Map(list.map((account) => [account.id, account])).values()
      );

      setAccounts(uniqueAccounts);

      const savedAccount = getSetting("primary_snapchat_account", "");
      const selected =
        uniqueAccounts.find((account) => account.id === savedAccount)?.id ||
        uniqueAccounts[0]?.id ||
        "";

      setAccountId(selected);

      if (selected) {
        saveSetting("primary_snapchat_account", selected);
      }
    } catch (err) {
      setError(err.message || "Failed to load Snapchat accounts");
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadCachedData() {
    setLoadingData(true);
    setError("");

    try {
      const query = buildQuery({
        account_id: accountId,
        level: currentLevel,
        date_preset: datePreset
      });

      const data = await apiGet(`/api/snapchat/data?${query}`);

      const normalizedRows = normalizeRows(data?.rows || data?.data || []);
      const normalizedSummary = normalizeSummary(data?.summary || {});

      setRows(normalizedRows);
      setSummary(normalizedSummary);
      setCacheInfo({
        source: data?.source,
        metric_date: data?.metric_date,
        loaded_rows: data?.loaded_rows || normalizedRows.length,
        is_cached_data: data?.is_cached_data,
        version: data?.version
      });
    } catch (err) {
      setRows([]);
      setSummary(normalizeSummary({}));
      setError(err.message || "Failed to load Snapchat cached data");
    } finally {
      setLoadingData(false);
    }
  }

  async function runSync(levelOverride = null) {
    if (!accountId) return;

    setSyncing(true);
    setError("");

    try {
      const levelForSync = levelOverride || currentLevel;

      const levels =
        levelForSync === "overview"
          ? "overview,campaign"
          : levelForSync === "ad"
            ? "ad"
            : levelForSync;

      const query = buildQuery({
        account_id: accountId,
        date_preset: datePreset,
        levels,
        limit: levelForSync === "ad" ? 50 : 20,
        candidate_limit: levelForSync === "ad" ? 160 : 160
      });

      const result = await apiGet(`/api/snapchat/sync?${query}`);

      if (!result?.success) {
        throw new Error(result?.error || "Snapchat sync failed");
      }

      await loadCachedData();
    } catch (err) {
      setError(err.message || "Snapchat sync failed");
    } finally {
      setSyncing(false);
    }
  }

  function handleAccountChange(value) {
    setAccountId(value);
    saveSetting("primary_snapchat_account", value);
  }

  const hasNoCache =
    !loadingData &&
    !syncing &&
    safeNumber(summary.spend) === 0 &&
    safeNumber(summary.revenue) === 0 &&
    safeNumber(summary.purchases) === 0 &&
    rows.length === 0;

  const pageTitle = getTitleFromTab(activeTab);

  return (
    <div className="dash-main">
      <div className="dash-hero">
        <div>
          <div className="dash-eyebrow">Snapchat Ads</div>
          <h1>👻 Snapchat Ads</h1>
          <p>
            Fast cached Snapchat performance from Supabase. Live Snapchat API is used only when you run Sync.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "flex-end"
          }}
        >
          <select
            value={accountId}
            onChange={(event) => handleAccountChange(event.target.value)}
            disabled={loadingAccounts || syncing}
            style={selectStyle}
          >
            {accounts.length === 0 ? (
              <option value="">No Snapchat accounts</option>
            ) : (
              accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name || account.id} — {account.currency || "USD"}
                </option>
              ))
            )}
          </select>

          <select
            value={datePreset}
            onChange={(event) => setDatePreset(event.target.value)}
            disabled={syncing}
            style={selectStyle}
          >
            {DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => loadCachedData()}
            disabled={!accountId || loadingData || syncing}
            style={secondaryButtonStyle}
          >
            ↻ Refresh Cache
          </button>

          <button
            onClick={() => runSync()}
            disabled={!accountId || syncing}
            style={primaryButtonStyle}
          >
            {syncing ? "Syncing..." : "⚡ Sync Now"}
          </button>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          marginBottom: 18,
          color: "#06d6a0",
          fontSize: 12,
          fontWeight: 800,
          textAlign: "right"
        }}
      >
        Base currency in page: SAR • Snapchat account: {selectedAccount?.currency || "USD"} • Source: Supabase Cache
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: 8,
          marginBottom: 18
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "14px 12px",
              borderRadius: 16,
              border:
                activeTab === tab.key
                  ? "1px solid #FFFC00"
                  : "1px solid var(--border)",
              background:
                activeTab === tab.key
                  ? "rgba(255,252,0,0.12)"
                  : "rgba(255,255,255,0.03)",
              color: activeTab === tab.key ? "#fff" : "var(--muted)",
              fontWeight: 900,
              cursor: "pointer"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div
          style={{
            padding: 14,
            borderRadius: 14,
            marginBottom: 18,
            border: "1px solid rgba(244,63,94,0.35)",
            background: "rgba(244,63,94,0.09)",
            color: "#fda4af",
            fontSize: 13,
            fontWeight: 800
          }}
        >
          {error}
        </div>
      ) : null}

      {cacheInfo ? (
        <div
          style={{
            padding: 12,
            borderRadius: 14,
            marginBottom: 18,
            border: "1px solid rgba(255,252,0,0.25)",
            background: "rgba(255,252,0,0.07)",
            color: "#FFFC00",
            fontSize: 13,
            fontWeight: 800,
            textAlign: "center"
          }}
        >
          Cache status: {cacheInfo.loaded_rows || 0} rows • Metric date: {cacheInfo.metric_date || "—"} • Version:{" "}
          {cacheInfo.version || "—"}
        </div>
      ) : null}

      <div className="dash-kpi-grid" style={{ marginBottom: 18 }}>
        <KpiCard
          label="Spend SAR"
          value={formatMoneySAR(summary.spend)}
          sub={`Original: ${formatMoneyUSD(summary.spend)}`}
          icon="💰"
          color="#FFFC00"
        />
        <KpiCard
          label="Revenue SAR"
          value={formatMoneySAR(summary.revenue)}
          sub={`Original: ${formatMoneyUSD(summary.revenue)}`}
          icon="💵"
          color="#06d6a0"
        />
        <KpiCard
          label="ROAS"
          value={formatROAS(summary.roas)}
          icon="📈"
          color="#f59e0b"
        />
        <KpiCard
          label="Purchases"
          value={formatNumber(summary.purchases)}
          icon="🛒"
          color="#8b5cf6"
        />
        <KpiCard
          label="CPA SAR"
          value={formatMoneySAR(summary.cpa)}
          icon="🎯"
          color="#ec4899"
        />
        <KpiCard
          label="Impressions"
          value={formatNumber(summary.impressions)}
          icon="👁️"
          color="#38bdf8"
        />
        <KpiCard
          label="Swipes"
          value={formatNumber(summary.swipes)}
          icon="👆"
          color="#6366f1"
        />
        <KpiCard
          label="CTR"
          value={formatPercent(summary.ctr)}
          icon="📊"
          color="#a855f7"
        />
        <KpiCard
          label="CPC SAR"
          value={formatMoneySAR(summary.cpc)}
          icon="🖱️"
          color="#f97316"
        />
        <KpiCard
          label="Video Views"
          value={formatNumber(summary.video_views)}
          icon="🎥"
          color="#22d3ee"
        />
      </div>

      {hasNoCache ? (
        <EmptyState
          title="No cached Snapchat data yet"
          description="This page now reads from Supabase cache for speed. Run Sync Now to pull Snapchat data once, save it into Supabase, then the dashboard will load fast."
          actionLabel="⚡ Sync Now"
          onAction={() => runSync()}
          loading={syncing}
        />
      ) : activeTab === "overview" ? (
        <div className="dash-table-card">
          <div className="dash-table-head">
            <div>
              <h2>Account Overview</h2>
              <p>Loaded from Supabase cache, not live Snapchat API.</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12
            }}
          >
            <MiniMetric label="Spend SAR" value={formatMoneySAR(summary.spend)} />
            <MiniMetric label="Revenue SAR" value={formatMoneySAR(summary.revenue)} />
            <MiniMetric label="ROAS" value={formatROAS(summary.roas)} />
            <MiniMetric label="Purchases" value={formatNumber(summary.purchases)} />
            <MiniMetric label="Impressions" value={formatNumber(summary.impressions)} />
            <MiniMetric label="Swipes" value={formatNumber(summary.swipes)} />
            <MiniMetric label="CTR" value={formatPercent(summary.ctr)} />
            <MiniMetric label="Video Views" value={formatNumber(summary.video_views)} />
          </div>
        </div>
      ) : activeTab === "creative" ? (
        <CreativeView rows={rows} loading={loadingData || syncing} />
      ) : (
        <DataTable title={pageTitle} rows={rows} loading={loadingData || syncing} />
      )}
    </div>
  );
}

const selectStyle = {
  minWidth: 210,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.06)",
  color: "var(--text)",
  fontWeight: 800,
  outline: "none"
};

const primaryButtonStyle = {
  padding: "12px 16px",
  borderRadius: 14,
  border: "1px solid rgba(255,252,0,0.45)",
  background: "rgba(255,252,0,0.14)",
  color: "#FFFC00",
  fontWeight: 900,
  cursor: "pointer"
};

const secondaryButtonStyle = {
  padding: "12px 16px",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.06)",
  color: "var(--text)",
  fontWeight: 900,
  cursor: "pointer"
};
