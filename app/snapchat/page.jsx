"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";

const SAR_RATE = 3.75;

const DATE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7d", label: "Last 7 Days" },
  { value: "last_30d", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
  { value: "last_90d", label: "Last 90 Days" },
  { value: "maximum", label: "Last 12 Months" }
];

// Matches Snapchat Ads Manager's attribution settings. Defaulting to
// 28-day swipe / 1-day view mirrors Ads Manager's own default, but these
// are user-adjustable since real accounts often use different windows.
const SWIPE_WINDOW_OPTIONS = [
  { value: "1_DAY", label: "1 Day Swipe" },
  { value: "7_DAY", label: "7 Day Swipe" },
  { value: "28_DAY", label: "28 Day Swipe" }
];

const VIEW_WINDOW_OPTIONS = [
  { value: "1_HOUR", label: "1 Hour View" },
  { value: "3_HOUR", label: "3 Hour View" },
  { value: "6_HOUR", label: "6 Hour View" },
  { value: "1_DAY", label: "1 Day View" },
  { value: "7_DAY", label: "7 Day View" },
  { value: "28_DAY", label: "28 Day View" }
];

const TABS = [
  { key: "overview", label: "Overview", level: "overview" },
  { key: "campaigns", label: "Campaigns", level: "campaign" },
  { key: "adsquads", label: "Ad Squads", level: "adsquad" },
  { key: "ads", label: "Ads", level: "ad" },
  { key: "creative", label: "Creative", level: "ad" }
];

function safeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function buildQuery(params) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  return query.toString();
}

function toSAR(value) {
  return safeNumber(value) * SAR_RATE;
}

function moneySAR(value) {
  return `SAR ${toSAR(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function moneyInCurrency(value, currency = "USD") {
  const safeCurrency = String(currency || "USD").toUpperCase();
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: safeCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(safeNumber(value));
}

function number(value) {
  return safeNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
}

function percent(value) {
  return `${safeNumber(value).toFixed(2)}%`;
}

function roas(value) {
  return `${safeNumber(value).toFixed(2)}x`;
}

function getLevel(tab) {
  return TABS.find((item) => item.key === tab)?.level || "overview";
}

function getTabLabel(tab) {
  return TABS.find((item) => item.key === tab)?.label || "Overview";
}

function normalizeSummary(summary = {}) {
  const spend = safeNumber(summary.spend);
  const revenue = safeNumber(summary.revenue || summary.purchase_value);
  const purchases = safeNumber(summary.purchases);
  const impressions = safeNumber(summary.impressions);
  const swipes = safeNumber(summary.swipes || summary.clicks);
  const videoViews = safeNumber(summary.video_views);

  return {
    currency: summary.currency || "USD",
    spend,
    revenue,
    purchases,
    impressions,
    swipes,
    clicks: swipes,
    video_views: videoViews,
    roas: spend ? revenue / spend : safeNumber(summary.roas),
    cpa: purchases ? spend / purchases : safeNumber(summary.cpa),
    ctr: impressions ? (swipes / impressions) * 100 : safeNumber(summary.ctr),
    cpc: swipes ? spend / swipes : safeNumber(summary.cpc),
    cpm: impressions ? (spend / impressions) * 1000 : safeNumber(summary.cpm)
  };
}

function normalizeRows(rows = []) {
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
        row.entity_name ||
        row.campaign_name ||
        row.adsquad_name ||
        row.ad_name ||
        "Unnamed",
      status: row.status || row.raw?.status || row.raw?.raw_status || "UNKNOWN",
      spend,
      revenue,
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

function roasColor(value) {
  const x = safeNumber(value);
  if (x >= 3) return "#12e6a3";
  if (x >= 1) return "#f6b73c";
  return "#ff4d8d";
}

function statusColor(status) {
  const raw = String(status || "").toUpperCase();

  if (raw === "ACTIVE") return "#12e6a3";
  if (raw === "PAUSED") return "#f6b73c";
  if (raw === "PENDING") return "#8b7cff";

  return "#8b95c9";
}

function StatusBadge({ status }) {
  const label = String(status || "UNKNOWN").toUpperCase();
  const color = statusColor(label);

  return (
    <span className="snap-status" style={{ color, borderColor: `${color}55` }}>
      <span style={{ background: color }} />
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub, icon, tone = "cyan" }) {
  return (
    <div className={`snap-card snap-card-${tone}`}>
      <div className="snap-card-head">
        <span>{label}</span>
        <b>{icon}</b>
      </div>

      <strong>{value}</strong>

      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="snap-mini">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, description, actionLabel, onAction, loading }) {
  return (
    <div className="snap-empty">
      <div className="snap-empty-icon">👻</div>
      <h3>{title}</h3>
      <p>{description}</p>

      {actionLabel ? (
        <button onClick={onAction} disabled={loading} className="snap-primary">
          {loading ? "Syncing..." : actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function DataTable({ title, rows, loading }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDir, setSortDir] = useState("desc");

  const finalRows = useMemo(() => {
    let list = [...rows];

    if (statusFilter !== "all") {
      list = list.filter(
        (row) => String(row.status || "").toLowerCase() === statusFilter
      );
    }

    list.sort((a, b) => {
      const av = safeNumber(a[sortKey]);
      const bv = safeNumber(b[sortKey]);
      return sortDir === "asc" ? av - bv : bv - av;
    });

    return list;
  }, [rows, statusFilter, sortKey, sortDir]);

  function sortBy(key) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDir("desc");
  }

  function Th({ id, children }) {
    return (
      <th onClick={() => sortBy(id)}>
        {children}
        {sortKey === id ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  if (loading) {
    return (
      <section className="snap-panel">
        <div className="snap-skeleton-title" />
        <div className="snap-skeleton-line" />
        <div className="snap-skeleton-table" />
      </section>
    );
  }

  return (
    <section className="snap-panel">
      <div className="snap-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{finalRows.length} cached rows</p>
        </div>

        <div className="snap-filter">
          {[
            { key: "all", label: "All" },
            { key: "active", label: "Active" },
            { key: "paused", label: "Paused" }
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setStatusFilter(item.key)}
              className={statusFilter === item.key ? "active" : ""}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {finalRows.length === 0 ? (
        <EmptyState
          title="No cached rows for this view"
          description="Run Sync Now for this account and date range, then refresh the cache."
        />
      ) : (
        <div className="snap-table-wrap">
          <table className="snap-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <Th id="spend">Spend</Th>
                <Th id="revenue">Revenue</Th>
                <Th id="roas">ROAS</Th>
                <Th id="purchases">Purchases</Th>
                <Th id="cpa">CPA</Th>
                <Th id="impressions">Impressions</Th>
                <Th id="swipes">Swipes</Th>
                <Th id="ctr">CTR</Th>
                <Th id="video_views">Video Views</Th>
              </tr>
            </thead>

            <tbody>
              {finalRows.map((row, index) => (
                <tr key={row.id || index}>
                  <td className="snap-name">{row.name}</td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                  <td>
                    <b>{moneyInCurrency(row.spend, row.currency)}</b>
                    {row.currency === "USD" ? <small>{moneySAR(row.spend)}</small> : null}
                  </td>
                  <td>
                    <b>{moneyInCurrency(row.revenue, row.currency)}</b>
                    {row.currency === "USD" ? <small>{moneySAR(row.revenue)}</small> : null}
                  </td>
                  <td style={{ color: roasColor(row.roas), fontWeight: 900 }}>
                    {roas(row.roas)}
                  </td>
                  <td>{number(row.purchases)}</td>
                  <td>{moneyInCurrency(row.cpa, row.currency)}</td>
                  <td>{number(row.impressions)}</td>
                  <td>{number(row.swipes)}</td>
                  <td>{percent(row.ctr)}</td>
                  <td>{number(row.video_views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CreativeView({ rows, loading }) {
  const creatives = useMemo(() => {
    const map = new Map();

    rows.forEach((row) => {
      const name = row.name || "Unnamed Creative";
      const key = name.trim().toLowerCase();

      if (!map.has(key)) {
        map.set(key, {
          id: row.id,
          name,
          currency: row.currency || "USD",
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
    return (
      <section className="snap-panel">
        <div className="snap-skeleton-title" />
        <div className="snap-skeleton-table" />
      </section>
    );
  }

  if (!creatives.length) {
    return (
      <section className="snap-panel">
        <EmptyState
          title="No creative cache yet"
          description="Sync Ads data first. Creative analysis will be generated from cached Ads rows."
        />
      </section>
    );
  }

  return (
    <section className="snap-panel">
      <div className="snap-panel-head">
        <div>
          <h2>Creative Analysis</h2>
          <p>{creatives.length} creative groups from cached ads</p>
        </div>
      </div>

      <div className="snap-creative-grid">
        {creatives.map((item) => {
          const state =
            item.roas >= 3 && item.purchases > 0
              ? "Winner"
              : item.spend > 50 && item.roas < 1
                ? "Needs Review"
                : "Monitor";

          return (
            <div key={item.id || item.name} className="snap-creative-card">
              <div className="snap-creative-top">
                <div>
                  <span>{state}</span>
                  <h3>{item.name}</h3>
                </div>
                <StatusBadge status={item.status} />
              </div>

              <div className="snap-creative-metrics">
                <MiniMetric label="Spend" value={moneyInCurrency(item.spend, item.currency)} />
                <MiniMetric label="Revenue" value={moneyInCurrency(item.revenue, item.currency)} />
                <MiniMetric label="ROAS" value={roas(item.roas)} />
                <MiniMetric label="Purchases" value={number(item.purchases)} />
                <MiniMetric label="CTR" value={percent(item.ctr)} />
                <MiniMetric label="Ads" value={`x${item.count}`} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function SnapchatPage() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [datePreset, setDatePreset] = useState("last_30d");
  const [swipeWindow, setSwipeWindow] = useState(() =>
    getSetting("snapchat_swipe_window", "28_DAY")
  );
  const [viewWindow, setViewWindow] = useState(() =>
    getSetting("snapchat_view_window", "1_DAY")
  );
  const [activeTab, setActiveTab] = useState("overview");

  const [summary, setSummary] = useState(normalizeSummary({}));
  const [rows, setRows] = useState([]);
  const [cacheInfo, setCacheInfo] = useState(null);

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === accountId) || null,
    [accounts, accountId]
  );

  const currentLevel = getLevel(activeTab);
  const accountCurrency = selectedAccount?.currency || summary.currency || "USD";
  const secondaryMoney = (value) =>
    accountCurrency === "USD" ? moneySAR(value) : null;

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!accountId) return;
    loadCachedData();
  }, [accountId, datePreset, activeTab]);

  async function loadAccounts() {
    setError("");
    setLoadingAccounts(true);

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

      const saved = getSetting("primary_snapchat_account", "");
      const selected =
        uniqueAccounts.find((account) => account.id === saved)?.id ||
        uniqueAccounts[0]?.id ||
        "";

      setAccountId(selected);
      if (selected) saveSetting("primary_snapchat_account", selected);
    } catch (err) {
      setError(err.message || "Failed to load Snapchat accounts");
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadCachedData() {
    setError("");
    setNotice("");
    setLoadingData(true);

    try {
      const query = buildQuery({
        account_id: accountId,
        level: currentLevel,
        date_preset: datePreset
      });

      const data = await apiGet(`/api/snapchat/data?${query}`);

      const nextSummary = normalizeSummary(data?.summary || {});
      const nextRows = normalizeRows(data?.rows || data?.data || []);

      setSummary(nextSummary);
      setRows(nextRows);
      setCacheInfo({
        source: data?.source || "supabase_cache",
        loadedRows: data?.loaded_rows || nextRows.length,
        metricDate: data?.metric_date || "",
        cached: Boolean(data?.is_cached_data)
      });
    } catch (err) {
      setRows([]);
      setSummary(normalizeSummary({}));
      setCacheInfo(null);
      setError(err.message || "Failed to load Snapchat cache");
    } finally {
      setLoadingData(false);
    }
  }

  async function runSync() {
    if (!accountId) return;

    setSyncing(true);
    setError("");
    setNotice("Sync started. This may take a little time for large accounts.");

    try {
      // "overview" is always included: it's the single source of truth for
      // the top-line summary cards on every tab, so it must be kept fresh
      // no matter which tab the user syncs from — not just the Overview tab.
      const levels =
        currentLevel === "overview"
          ? "overview"
          : currentLevel === "ad"
            ? "overview,ad"
            : `overview,${currentLevel}`;

      const query = buildQuery({
        account_id: accountId,
        date_preset: datePreset,
        levels,
        limit: currentLevel === "ad" ? 50 : 20,
        candidate_limit: 1000,
        swipe_window: swipeWindow,
        view_window: viewWindow
      });

      const result = await apiPost(`/api/snapchat/sync?${query}`, {}, {
        timeoutMs: 60_000
      });

      if (!result?.success) {
        throw new Error(result?.error || "Snapchat sync failed");
      }

      setNotice(`Sync completed. Inserted rows: ${result.inserted_rows || 0}`);
      await loadCachedData();
    } catch (err) {
      setError(err.message || "Snapchat sync failed");
      setNotice("");
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
    safeNumber(summary.spend) === 0 &&
    safeNumber(summary.revenue) === 0 &&
    safeNumber(summary.purchases) === 0 &&
    rows.length === 0;

  return (
    <div className="snap-page">
      <style>{`
        .snap-page {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .snap-control-card {
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.035);
          border-radius: 18px;
          padding: 14px;
        }

        .snap-control-grid {
          display: grid;
          grid-template-columns: minmax(220px, 1.4fr) minmax(180px, 1fr) auto;
          gap: 10px;
          align-items: center;
        }

        .snap-select {
          width: 100%;
          height: 46px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(7,10,22,0.75);
          color: #fff;
          padding: 0 12px;
          font-weight: 800;
          outline: none;
        }

        .snap-select option {
          background: #0b1020;
          color: #fff;
        }

        .snap-attribution-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }

        .snap-attribution-label {
          font-size: 12px;
          font-weight: 800;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .snap-select-sm {
          width: auto;
          height: 36px;
          padding: 0 10px;
          font-size: 13px;
          font-weight: 700;
        }

        .snap-attribution-hint {
          font-size: 12px;
          color: var(--muted);
          opacity: 0.75;
        }

        .snap-control-actions {
          display: flex;
          gap: 10px;
        }

        .snap-primary,
        .snap-secondary {
          height: 46px;
          padding: 0 20px;
          border-radius: 14px;
          font-weight: 900;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }

        .snap-primary {
          border: 1px solid rgba(255,252,0,0.48);
          color: #05060a;
          background: linear-gradient(135deg, #fffc00, #22d3ee);
          box-shadow: 0 14px 32px rgba(255,252,0,0.14);
        }

        .snap-secondary {
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(255,255,255,0.055);
          color: #fff;
        }

        .snap-primary:disabled,
        .snap-secondary:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .snap-tabs {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 2px;
        }

        .snap-tab {
          flex: 0 0 auto;
          min-height: 44px;
          padding: 0 18px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.035);
          color: var(--muted);
          font-weight: 900;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }

        .snap-tab.active {
          color: #05060a;
          border-color: rgba(255,252,0,0.65);
          background: linear-gradient(135deg, #fffc00, #22d3ee);
          box-shadow: 0 18px 34px rgba(34,211,238,0.13);
        }

        .snap-alert {
          border-radius: 16px;
          padding: 12px 14px;
          font-weight: 800;
          font-size: 13px;
          line-height: 1.6;
        }

        .snap-alert.error {
          color: #fecaca;
          background: rgba(244,63,94,0.11);
          border: 1px solid rgba(244,63,94,0.28);
        }

        .snap-alert.info {
          color: #d9f99d;
          background: rgba(255,252,0,0.08);
          border: 1px solid rgba(255,252,0,0.18);
        }

        .snap-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 14px;
        }

        .snap-card {
          min-height: 128px;
          border-radius: 22px;
          padding: 18px;
          border: 1px solid rgba(255,255,255,0.08);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025)),
            rgba(12,16,32,0.82);
          position: relative;
          overflow: hidden;
        }

        .snap-card::before {
          content: "";
          position: absolute;
          inset: 0 0 auto 0;
          height: 3px;
          background: #22d3ee;
        }

        .snap-card-yellow::before { background: #fffc00; }
        .snap-card-green::before { background: #12e6a3; }
        .snap-card-purple::before { background: #8b7cff; }
        .snap-card-pink::before { background: #ff4d8d; }
        .snap-card-orange::before { background: #f6b73c; }
        .snap-card-cyan::before { background: #22d3ee; }

        .snap-card-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          color: var(--muted);
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.09em;
        }

        .snap-card strong {
          display: block;
          color: #fff;
          font-size: clamp(20px, 2vw, 28px);
          margin-top: 16px;
          font-family: 'Space Grotesk', sans-serif;
        }

        .snap-card small {
          display: block;
          margin-top: 8px;
          color: var(--muted);
          font-size: 12px;
        }

        .snap-panel {
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(12,16,32,0.72);
          border-radius: 26px;
          padding: 20px;
        }

        .snap-panel-head {
          display: flex;
          justify-content: space-between;
          gap: 14px;
          align-items: center;
          margin-bottom: 18px;
        }

        .snap-panel-head h2 {
          margin: 0;
          color: #fff;
          font-size: 20px;
        }

        .snap-panel-head p {
          margin: 5px 0 0;
          color: var(--muted);
          font-size: 13px;
        }

        .snap-overview-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .snap-mini {
          border-radius: 16px;
          padding: 14px;
          border: 1px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.035);
        }

        .snap-mini span {
          display: block;
          color: var(--muted);
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 8px;
        }

        .snap-mini strong {
          color: #fff;
          font-size: 16px;
        }

        .snap-filter {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .snap-filter button {
          border-radius: 999px;
          padding: 8px 12px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .snap-filter button.active {
          color: #05060a;
          border-color: #fffc00;
          background: #fffc00;
        }

        .snap-table-wrap {
          overflow: auto;
        }

        .snap-table {
          width: 100%;
          min-width: 1100px;
          border-collapse: collapse;
        }

        .snap-table th {
          text-align: left;
          color: var(--muted);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 12px 10px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          cursor: pointer;
          white-space: nowrap;
        }

        .snap-table td {
          padding: 14px 10px;
          color: var(--text-2);
          border-bottom: 1px solid rgba(255,255,255,0.055);
          vertical-align: top;
          font-size: 13px;
        }

        .snap-table td b {
          display: block;
          color: #fff;
          font-size: 13px;
        }

        .snap-table td small {
          display: block;
          color: var(--muted);
          margin-top: 4px;
          font-size: 11px;
        }

        .snap-name {
          color: #fff !important;
          font-weight: 900;
          max-width: 360px;
        }

        .snap-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 10px;
          font-weight: 900;
          background: rgba(255,255,255,0.035);
        }

        .snap-status span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .snap-empty {
          min-height: 260px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 24px;
        }

        .snap-empty-icon {
          width: 54px;
          height: 54px;
          display: grid;
          place-items: center;
          border-radius: 18px;
          background: rgba(255,252,0,0.10);
          border: 1px solid rgba(255,252,0,0.20);
          margin-bottom: 14px;
          font-size: 26px;
        }

        .snap-empty h3 {
          margin: 0;
          color: #fff;
        }

        .snap-empty p {
          color: var(--muted);
          max-width: 620px;
          line-height: 1.7;
        }

        .snap-creative-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 14px;
        }

        .snap-creative-card {
          border-radius: 22px;
          padding: 16px;
          border: 1px solid rgba(255,255,255,0.08);
          background:
            radial-gradient(circle at 70% 10%, rgba(255,252,0,0.09), transparent 28%),
            rgba(255,255,255,0.035);
        }

        .snap-creative-top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 14px;
        }

        .snap-creative-top span {
          color: #fffc00;
          font-size: 11px;
          font-weight: 900;
        }

        .snap-creative-top h3 {
          color: #fff;
          margin: 5px 0 0;
          font-size: 14px;
          line-height: 1.5;
        }

        .snap-creative-metrics {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .snap-skeleton-title,
        .snap-skeleton-line,
        .snap-skeleton-table {
          border-radius: 14px;
          background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.09), rgba(255,255,255,0.04));
          background-size: 200% 100%;
          animation: snapPulse 1.2s infinite linear;
        }

        .snap-skeleton-title {
          width: 220px;
          height: 24px;
          margin-bottom: 12px;
        }

        .snap-skeleton-line {
          width: 360px;
          height: 14px;
          margin-bottom: 18px;
        }

        .snap-skeleton-table {
          width: 100%;
          height: 260px;
        }

        @keyframes snapPulse {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        @media (max-width: 1150px) {
          .snap-overview-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .snap-control-grid {
            grid-template-columns: 1fr;
          }

          .snap-control-actions {
            flex-direction: column;
          }

          .snap-overview-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="snap-control-card">
        <div className="snap-control-grid">
          <select
            value={accountId}
            onChange={(event) => handleAccountChange(event.target.value)}
            disabled={loadingAccounts || syncing}
            className="snap-select"
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
            className="snap-select"
          >
            {DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="snap-control-actions">
            <button
              onClick={() => runSync()}
              disabled={!accountId || syncing}
              className="snap-primary"
            >
              {syncing ? "Syncing..." : "Sync Now"}
            </button>

            <button
              onClick={() => loadCachedData()}
              disabled={!accountId || loadingData || syncing}
              className="snap-secondary"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="snap-attribution-row">
          <span className="snap-attribution-label">Attribution:</span>

          <select
            value={swipeWindow}
            onChange={(event) => {
              setSwipeWindow(event.target.value);
              saveSetting("snapchat_swipe_window", event.target.value);
            }}
            disabled={syncing}
            className="snap-select snap-select-sm"
          >
            {SWIPE_WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={viewWindow}
            onChange={(event) => {
              setViewWindow(event.target.value);
              saveSetting("snapchat_view_window", event.target.value);
            }}
            disabled={syncing}
            className="snap-select snap-select-sm"
          >
            {VIEW_WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <span className="snap-attribution-hint">
            Changes apply on next Sync Now — match this to your Snapchat Ads
            Manager attribution settings to avoid number mismatches.
          </span>
        </div>
      </div>

      <div className="snap-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`snap-tab ${activeTab === tab.key ? "active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <div className="snap-alert error">{error}</div> : null}
      {notice ? <div className="snap-alert info">{notice}</div> : null}

      <div className="snap-grid">
        <KpiCard
          label="Spend"
          value={moneyInCurrency(summary.spend, accountCurrency)}
          sub={secondaryMoney(summary.spend)}
          icon="💰"
          tone="yellow"
        />
        <KpiCard
          label="Revenue"
          value={moneyInCurrency(summary.revenue, accountCurrency)}
          sub={secondaryMoney(summary.revenue)}
          icon="💵"
          tone="green"
        />
        <KpiCard
          label="ROAS"
          value={roas(summary.roas)}
          icon="📈"
          tone="orange"
        />
        <KpiCard
          label="Purchases"
          value={number(summary.purchases)}
          icon="🛒"
          tone="purple"
        />
        <KpiCard
          label="CPA"
          value={moneyInCurrency(summary.cpa, accountCurrency)}
          sub={secondaryMoney(summary.cpa)}
          icon="🎯"
          tone="pink"
        />
        <KpiCard
          label="Impressions"
          value={number(summary.impressions)}
          icon="👁️"
          tone="cyan"
        />
        <KpiCard
          label="Swipes"
          value={number(summary.swipes)}
          icon="👆"
          tone="purple"
        />
        <KpiCard
          label="CTR"
          value={percent(summary.ctr)}
          icon="📊"
          tone="orange"
        />
        <KpiCard
          label="CPC"
          value={moneyInCurrency(summary.cpc, accountCurrency)}
          sub={secondaryMoney(summary.cpc)}
          icon="🖱️"
          tone="cyan"
        />
        <KpiCard
          label="Video Views"
          value={number(summary.video_views)}
          icon="🎥"
          tone="green"
        />
      </div>

      {hasNoCache ? (
        <section className="snap-panel">
          <EmptyState
            title="No cached data for this selection"
            description="Run Sync Now to pull Snapchat data into Supabase. After that, the page will load from cache instead of calling Snapchat live."
            actionLabel="Sync Now"
            onAction={() => runSync()}
            loading={syncing}
          />
        </section>
      ) : activeTab === "overview" ? null : activeTab === "creative" ? (
        <CreativeView rows={rows} loading={loadingData || syncing} />
      ) : (
        <DataTable
          title={getTabLabel(activeTab)}
          rows={rows}
          loading={loadingData || syncing}
        />
      )}
    </div>
  );
}
