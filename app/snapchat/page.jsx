"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";

const DATE_OPTIONS = [
  { value: "maximum", label: "Maximum" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7d", label: "Last 7 Days" },
  { value: "last_30d", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
  { value: "last_90d", label: "Last 90 Days" }
];

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "campaigns", label: "Campaigns" },
  { key: "ad_squads", label: "Ad Squads" },
  { key: "ads", label: "Ads" },
  { key: "creative", label: "Creative" }
];

const EXCHANGE_RATES_TO_SAR = {
  SAR: 1,
  USD: 3.75,
  AED: 1.02,
  EGP: 0.078,
  EUR: 4.05,
  GBP: 4.8
};

function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function toSAR(value, currency = "USD") {
  const amount = safeNumber(value);
  const normalized = String(currency || "USD").toUpperCase();
  return amount * (EXCHANGE_RATES_TO_SAR[normalized] || 1);
}

function formatSAR(value) {
  return `SAR ${safeNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatUSD(value) {
  return `$${safeNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatNumber(value) {
  return safeNumber(value).toLocaleString();
}

function formatPercent(value) {
  return `${safeNumber(value).toFixed(2)}%`;
}

function formatROAS(value) {
  return `${safeNumber(value).toFixed(2)}x`;
}

function getAccountId(account) {
  return (
    account?.id ||
    account?.account_id ||
    account?.ad_account_id ||
    account?.snapchat_account_id ||
    account?.adaccount_id ||
    ""
  );
}

function getAccountName(account) {
  return (
    account?.name ||
    account?.account_name ||
    account?.organization_name ||
    account?.business_name ||
    "Snapchat Account"
  );
}

function normalizeAccountsResponse(response) {
  const raw =
    response?.data ||
    response?.accounts ||
    response?.adaccounts ||
    response?.snap_ad_accounts ||
    [];

  if (!Array.isArray(raw)) return [];

  const mapped = raw
    .map((item) => item?.adaccount || item?.account || item)
    .filter((item) => getAccountId(item));

  return Array.from(
    new Map(mapped.map((account) => [getAccountId(account), account])).values()
  );
}

function getSnapchatApiLevel(tab) {
  const value = String(tab || "").toLowerCase();

  if (value === "overview") return "overview";
  if (value === "campaign" || value === "campaigns") return "campaign";

  if (
    value === "adset" ||
    value === "adsets" ||
    value === "ad_squad" ||
    value === "ad_squads" ||
    value === "adsquad" ||
    value === "adsquads"
  ) {
    return "ad_squad";
  }

  if (value === "ad" || value === "ads") return "ad";

  return "overview";
}

function getTabTitle(tab) {
  if (tab === "overview") return "Account Overview";
  if (tab === "campaigns") return "Top Campaigns";
  if (tab === "ad_squads") return "Top Ad Squads";
  if (tab === "ads") return "Top Ads";
  if (tab === "creative") return "Creative";

  return "Snapchat";
}

function roasColor(value) {
  const roas = safeNumber(value);

  if (roas >= 5) return "#06d6a0";
  if (roas >= 2) return "#f59e0b";

  return "#ff477e";
}

function statusColor(status) {
  const s = String(status || "").toUpperCase();

  if (s.includes("ACTIVE")) return "#06d6a0";
  if (s.includes("ISSUE")) return "#f59e0b";
  if (s.includes("PAUSED")) return "#f59e0b";
  if (s.includes("DELETED")) return "#ff477e";

  return "#8b95c9";
}

function KpiCard({ label, value, sub, icon, color }) {
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
        <span className="dash-kpi-icon">{icon}</span>
        <span className="dash-kpi-label">{label}</span>
      </div>

      <strong
        style={{
          fontSize: 24,
          color: "var(--text)",
          fontWeight: 900,
          fontFamily: "'Space Grotesk', sans-serif"
        }}
      >
        {value}
      </strong>

      {sub && (
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div
      style={{
        minHeight: 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text)",
        fontWeight: 900,
        fontSize: 18
      }}
    >
      {message}
    </div>
  );
}

function SnapchatTable({ rows }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDirection, setSortDirection] = useState("desc");

  const filteredRows = useMemo(() => {
    let list = Array.isArray(rows) ? [...rows] : [];

    if (statusFilter === "active") {
      list = list.filter((row) =>
        String(row.status || "").toUpperCase().includes("ACTIVE")
      );
    }

    if (statusFilter === "paused") {
      list = list.filter((row) =>
        String(row.status || "").toUpperCase().includes("PAUSED")
      );
    }

    list.sort((a, b) => {
      const aValue = safeNumber(a[sortKey]);
      const bValue = safeNumber(b[sortKey]);

      if (sortDirection === "asc") return aValue - bValue;

      return bValue - aValue;
    });

    return list;
  }, [rows, statusFilter, sortKey, sortDirection]);

  function changeSort(key) {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection("desc");
  }

  if (!filteredRows.length) {
    return <EmptyState message="No data found" />;
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap"
        }}
      >
        {[
          { key: "all", label: "All" },
          { key: "active", label: "Active Only" },
          { key: "paused", label: "Paused Only" }
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setStatusFilter(item.key)}
            style={{
              border: "1px solid var(--border)",
              background:
                statusFilter === item.key
                  ? "rgba(255, 252, 0, 0.12)"
                  : "rgba(255,255,255,0.03)",
              color: statusFilter === item.key ? "#fffc00" : "var(--muted)",
              borderRadius: 999,
              padding: "8px 12px",
              fontWeight: 900,
              cursor: "pointer"
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="dash-table-scroll">
        <table className="dash-data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th onClick={() => changeSort("spend")} style={{ cursor: "pointer" }}>
                Spend SAR
              </th>
              <th onClick={() => changeSort("revenue")} style={{ cursor: "pointer" }}>
                Revenue SAR
              </th>
              <th onClick={() => changeSort("roas")} style={{ cursor: "pointer" }}>
                ROAS
              </th>
              <th onClick={() => changeSort("purchases")} style={{ cursor: "pointer" }}>
                Purchases
              </th>
              <th onClick={() => changeSort("cpa")} style={{ cursor: "pointer" }}>
                CPA SAR
              </th>
              <th onClick={() => changeSort("impressions")} style={{ cursor: "pointer" }}>
                Impressions
              </th>
              <th onClick={() => changeSort("swipes")} style={{ cursor: "pointer" }}>
                Swipes
              </th>
              <th onClick={() => changeSort("ctr")} style={{ cursor: "pointer" }}>
                CTR
              </th>
              <th onClick={() => changeSort("video_views")} style={{ cursor: "pointer" }}>
                Video Views
              </th>
            </tr>
          </thead>

          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id || row.name}>
                <td className="dash-name-cell">{row.name || "Untitled"}</td>

                <td>
                  <span
                    style={{
                      color: statusColor(row.status),
                      fontWeight: 900
                    }}
                  >
                    ● {row.status || "UNKNOWN"}
                  </span>
                </td>

                <td>{formatSAR(toSAR(row.spend, row.currency || "USD"))}</td>
                <td>{formatSAR(toSAR(row.revenue, row.currency || "USD"))}</td>

                <td style={{ color: roasColor(row.roas), fontWeight: 900 }}>
                  {formatROAS(row.roas)}
                </td>

                <td>{formatNumber(row.purchases)}</td>
                <td>{formatSAR(toSAR(row.cpa, row.currency || "USD"))}</td>
                <td>{formatNumber(row.impressions)}</td>
                <td>{formatNumber(row.swipes || row.clicks)}</td>
                <td>{formatPercent(row.ctr)}</td>
                <td>{formatNumber(row.video_views)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SnapchatPage() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedAccountName, setSelectedAccountName] = useState("");
  const [datePreset, setDatePreset] = useState("maximum");
  const [activeTab, setActiveTab] = useState("overview");

  const [dataByTab, setDataByTab] = useState({
    overview: null,
    campaigns: null,
    ad_squads: null,
    ads: null
  });

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    if (activeTab === "creative") return;

    loadSnapchatData(activeTab);
  }, [selectedAccountId, datePreset, activeTab]);

  async function loadAccounts() {
    setLoadingAccounts(true);
    setError("");

    try {
      const response = await apiGet("/api/snapchat/accounts");
      const normalizedAccounts = normalizeAccountsResponse(response);

      setAccounts(normalizedAccounts);

      const savedAccountId = getSetting("primary_snapchat_account", "");
      const validSavedAccount = normalizedAccounts.find(
        (account) => getAccountId(account) === savedAccountId
      );

      const firstAccount = normalizedAccounts[0];
      const accountToUse = validSavedAccount || firstAccount;

      if (accountToUse) {
        const id = getAccountId(accountToUse);
        const name = getAccountName(accountToUse);

        setSelectedAccountId(id);
        setSelectedAccountName(name);
        saveSetting("primary_snapchat_account", id);
      }
    } catch (err) {
      setError(err.message || "Failed to load Snapchat accounts");
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadSnapchatData(tab) {
    if (!selectedAccountId) return;

    setLoadingData(true);
    setError("");

    try {
      const apiLevel = getSnapchatApiLevel(tab);

      const params = new URLSearchParams();
      params.set("account_id", selectedAccountId);
      params.set("level", apiLevel);
      params.set("date_preset", datePreset);

      if (apiLevel === "overview") {
        params.set("limit", "0");
        params.set("candidate_limit", "0");
      } else {
        params.set("limit", "80");
        params.set("candidate_limit", "160");
      }

      const response = await apiGet(`/api/snapchat/insights?${params.toString()}`);

      setDataByTab((current) => ({
        ...current,
        [tab]: response
      }));
    } catch (err) {
      setError(err.message || "Failed to load Snapchat data");
      setDataByTab((current) => ({
        ...current,
        [tab]: null
      }));
    } finally {
      setLoadingData(false);
    }
  }

  function handleAccountChange(accountId) {
    const account = accounts.find((item) => getAccountId(item) === accountId);
    const name = account ? getAccountName(account) : "";

    setSelectedAccountId(accountId);
    setSelectedAccountName(name);
    saveSetting("primary_snapchat_account", accountId);

    setDataByTab({
      overview: null,
      campaigns: null,
      ad_squads: null,
      ads: null
    });
  }

  function refreshCurrentTab() {
    if (!selectedAccountId) {
      loadAccounts();
      return;
    }

    if (activeTab === "creative") return;

    loadSnapchatData(activeTab);
  }

  const currentData = dataByTab[activeTab] || null;
  const summary = currentData?.summary || {};
  const rows = currentData?.rows || currentData?.data || [];

  const summarySAR = {
    spend: toSAR(summary.spend, summary.currency || "USD"),
    revenue: toSAR(summary.revenue, summary.currency || "USD"),
    cpa: toSAR(summary.cpa, summary.currency || "USD"),
    cpc: toSAR(summary.cpc, summary.currency || "USD")
  };

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center"
        }}
      >
        <div>
          <h1
            style={{
              color: "var(--text)",
              fontSize: 26,
              fontWeight: 900,
              marginBottom: 4
            }}
          >
            Snapchat Ads 👻
          </h1>

          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            {selectedAccountName || "Connect Snapchat to load data"}
          </p>

          <p style={{ color: "#06d6a0", fontSize: 12, fontWeight: 900 }}>
            Base currency in page: SAR • Snapchat account: USD
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="dash-refresh"
            onClick={refreshCurrentTab}
            disabled={loadingData || loadingAccounts}
          >
            {loadingData ? "Loading..." : "Refresh ↺"}
          </button>

          <select
            value={datePreset}
            onChange={(event) => setDatePreset(event.target.value)}
            disabled={loadingData}
          >
            {DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={selectedAccountId}
            onChange={(event) => handleAccountChange(event.target.value)}
            disabled={loadingAccounts}
            style={{ minWidth: 260 }}
          >
            {accounts.length === 0 ? (
              <option value="">
                {loadingAccounts ? "Loading accounts..." : "No accounts found"}
              </option>
            ) : (
              accounts.map((account) => {
                const id = getAccountId(account);
                const name = getAccountName(account);
                const currency = account.currency || account.account_currency || "USD";

                return (
                  <option key={id} value={id}>
                    {name} — {currency}
                  </option>
                );
              })
            )}
          </select>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: 8,
          border: "1px solid var(--border)",
          borderRadius: 18,
          padding: 6,
          background: "rgba(255,255,255,0.03)"
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              border: "none",
              borderRadius: 14,
              padding: "12px 10px",
              cursor: "pointer",
              fontWeight: 900,
              color: activeTab === tab.key ? "var(--text)" : "var(--muted)",
              background:
                activeTab === tab.key
                  ? "rgba(255,252,0,0.12)"
                  : "transparent",
              borderBottom:
                activeTab === tab.key
                  ? "2px solid #fffc00"
                  : "2px solid transparent"
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 14,
            border: "1px solid rgba(255,71,126,0.35)",
            background: "rgba(255,71,126,0.08)",
            color: "#ff477e",
            fontWeight: 900
          }}
        >
          {error}
        </div>
      )}

      {currentData?.partial_data && activeTab !== "overview" && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            border: "1px solid rgba(245,158,11,0.35)",
            background: "rgba(245,158,11,0.08)",
            color: "#f59e0b",
            fontWeight: 800
          }}
        >
          Top performers only: scanned {currentData.scanned_entities || 0} of{" "}
          {currentData.total_entities_available || 0} entities. Full historical entity table needs background sync.
        </div>
      )}

      {activeTab === "creative" ? (
        <div className="dash-table-card">
          <EmptyState message="Creative analysis will use Snapchat Ads data in the next step." />
        </div>
      ) : (
        <>
          <section className="dash-kpi-grid">
            <KpiCard
              label="Spend (SAR)"
              value={loadingData ? "—" : formatSAR(summarySAR.spend)}
              sub={`Original: ${formatUSD(summary.spend)}`}
              icon="💰"
              color="#fffc00"
            />

            <KpiCard
              label="Revenue (SAR)"
              value={loadingData ? "—" : formatSAR(summarySAR.revenue)}
              sub={`Original: ${formatUSD(summary.revenue)}`}
              icon="💵"
              color="#06d6a0"
            />

            <KpiCard
              label="ROAS"
              value={loadingData ? "—" : formatROAS(summary.roas)}
              icon="📈"
              color={roasColor(summary.roas)}
            />

            <KpiCard
              label="Purchases"
              value={loadingData ? "—" : formatNumber(summary.purchases)}
              icon="🛒"
              color="#06d6a0"
            />

            <KpiCard
              label="CPA (SAR)"
              value={loadingData ? "—" : formatSAR(summarySAR.cpa)}
              icon="🎯"
              color="#ff477e"
            />

            <KpiCard
              label="Swipes"
              value={loadingData ? "—" : formatNumber(summary.swipes)}
              icon="👆"
              color="#8b5cf6"
            />

            <KpiCard
              label="Impressions"
              value={loadingData ? "—" : formatNumber(summary.impressions)}
              icon="👁️"
              color="#38bdf8"
            />

            <KpiCard
              label="CTR"
              value={loadingData ? "—" : formatPercent(summary.ctr)}
              icon="📊"
              color="#8b5cf6"
            />

            <KpiCard
              label="CPC (SAR)"
              value={loadingData ? "—" : formatSAR(summarySAR.cpc)}
              icon="🖱️"
              color="#f59e0b"
            />

            <KpiCard
              label="Video Views"
              value={loadingData ? "—" : formatNumber(summary.video_views)}
              icon="🎥"
              color="#38bdf8"
            />
          </section>

          <section
            style={{
              display: "grid",
              gridTemplateColumns:
                activeTab === "overview" ? "1fr 1.8fr" : "1fr",
              gap: 18
            }}
          >
            {activeTab === "overview" && (
              <div className="dash-table-card">
                <div className="dash-table-head">
                  <div>
                    <h2>Account Summary</h2>
                    <p>{currentData?.summary_source || "account_stats"}</p>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  {[
                    ["Impressions", summary.impressions],
                    ["Video Views", summary.video_views],
                    ["Swipes", summary.swipes],
                    ["Purchases", summary.purchases],
                    ["ROAS", formatROAS(summary.roas)]
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        paddingBottom: 10,
                        borderBottom: "1px solid var(--border)"
                      }}
                    >
                      <span style={{ color: "var(--muted)" }}>{label}</span>
                      <strong style={{ color: "var(--text)" }}>
                        {typeof value === "string" ? value : formatNumber(value)}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="dash-table-card">
              <div className="dash-table-head">
                <div>
                  <h2>{getTabTitle(activeTab)}</h2>
                  <p>
                    {loadingData
                      ? "Loading..."
                      : activeTab === "overview"
                      ? `Fast account-level summary • ${currentData?.currency || "USD"}`
                      : `${rows.length} rows • original ${currentData?.currency || "USD"} • display SAR`}
                  </p>
                </div>
              </div>

              {loadingData ? (
                <EmptyState message="Loading Snapchat data..." />
              ) : activeTab === "overview" ? (
                <EmptyState message="Overview uses account-level KPIs above. Open Campaigns, Ad Squads or Ads for top performer rows." />
              ) : (
                <SnapchatTable rows={rows} />
              )}
            </div>
          </section>

          {Array.isArray(currentData?.errors) && currentData.errors.length > 0 && (
            <div className="dash-table-card">
              <div className="dash-table-head">
                <div>
                  <h2>API Notes</h2>
                  <p>Some rows could not be loaded from Snapchat API</p>
                </div>
              </div>

              <div className="dash-table-scroll">
                <table className="dash-data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Error</th>
                    </tr>
                  </thead>

                  <tbody>
                    {currentData.errors.slice(0, 10).map((item, index) => (
                      <tr key={`${item.id || item.name}-${index}`}>
                        <td>{item.name || item.id || "Unknown"}</td>
                        <td>{item.status || "—"}</td>
                        <td>{item.error || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
