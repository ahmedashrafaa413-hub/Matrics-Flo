"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import { formatSAR, formatNumber, formatROAS } from "../../lib/currency";

const DATE_OPTIONS = [
  { value: "today", label: "اليوم" },
  { value: "yesterday", label: "أمس" },
  { value: "last_7d", label: "آخر 7 أيام" },
  { value: "last_30d", label: "آخر 30 يوم" },
  { value: "this_month", label: "هذا الشهر" },
  { value: "last_90d", label: "آخر 90 يوم" },
  { value: "maximum", label: "كل الفترة" }
];

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
    account?.business_name ||
    account?.organization_name ||
    "Account"
  );
}

function normalizeMetaAccounts(response) {
  const raw = response?.data || response?.accounts || [];

  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => item?.account || item?.adaccount || item)
    .filter((item) => getAccountId(item));
}

function normalizeSnapchatAccounts(response) {
  const raw = response?.data || response?.accounts || response?.adaccounts || [];

  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => item?.account || item?.adaccount || item)
    .filter((item) => getAccountId(item));
}

function roasColor(value) {
  const roas = Number(value || 0);

  if (roas >= 5) return "#06d6a0";
  if (roas >= 2) return "#f59e0b";

  return "#ff477e";
}

function KPICard({ label, value, sub, icon, color }) {
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

      {sub && (
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function SourceIcon({ source }) {
  const s = String(source || "").toLowerCase();

  let icon = "📊";
  let color = "#8b95c9";

  if (s.includes("meta")) {
    icon = "f";
    color = "#1877f2";
  }

  if (s.includes("snapchat")) {
    icon = "👻";
    color = "#fffc00";
  }

  if (s.includes("salla")) {
    icon = "س";
    color = "#8b5cf6";
  }

  if (s.includes("total") || s.includes("الإجمالي")) {
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

  const [metaAccounts, setMetaAccounts] = useState([]);
  const [snapchatAccounts, setSnapchatAccounts] = useState([]);

  const [metaAccountId, setMetaAccountId] = useState("");
  const [snapchatAccountId, setSnapchatAccountId] = useState("");

  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("all");

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!metaAccountId && !snapchatAccountId) return;
    loadData();
  }, [datePreset, metaAccountId, snapchatAccountId]);

  async function loadAccounts() {
    setLoadingAccounts(true);
    setError("");

    try {
      const [metaResponse, snapchatResponse] = await Promise.allSettled([
        apiGet("/api/meta/accounts"),
        apiGet("/api/snapchat/accounts")
      ]);

      let nextMetaAccounts = [];
      let nextSnapchatAccounts = [];

      if (metaResponse.status === "fulfilled") {
        nextMetaAccounts = normalizeMetaAccounts(metaResponse.value);
      }

      if (snapchatResponse.status === "fulfilled") {
        nextSnapchatAccounts = normalizeSnapchatAccounts(snapchatResponse.value);
      }

      setMetaAccounts(nextMetaAccounts);
      setSnapchatAccounts(nextSnapchatAccounts);

      const savedMetaId = getSetting("primary_meta_account", "");
      const savedSnapId = getSetting("primary_snapchat_account", "");

      const validMeta =
        nextMetaAccounts.find((account) => getAccountId(account) === savedMetaId) ||
        nextMetaAccounts[0];

      const validSnap =
        nextSnapchatAccounts.find(
          (account) => getAccountId(account) === savedSnapId
        ) || nextSnapchatAccounts[0];

      if (validMeta) {
        const id = getAccountId(validMeta);
        setMetaAccountId(id);
        saveSetting("primary_meta_account", id);
      }

      if (validSnap) {
        const id = getAccountId(validSnap);
        setSnapchatAccountId(id);
        saveSetting("primary_snapchat_account", id);
      }
    } catch (err) {
      setError(err.message || "Failed to load accounts");
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadData() {
    setLoadingData(true);
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

      params.set("salla_currency", "SAR");

      const result = await apiGet(
        `/api/performance/overview?${params.toString()}`
      );

      setData(result);
    } catch (err) {
      setData(null);
      setError(err.message || "Failed to load performance overview");
    } finally {
      setLoadingData(false);
    }
  }

  function handleMetaChange(value) {
    setMetaAccountId(value);
    saveSetting("primary_meta_account", value);
  }

  function handleSnapchatChange(value) {
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
      return sources.filter(
        (row) => row.type === "organic" || row.type === "total"
      );
    }

    return sources;
  }, [sources, activeTab]);

  return (
    <main dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
            نظرة عامة على الأداء 📊
          </h1>

          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            ROAS الفعلي = مبيعات سلة ÷ إجمالي الإنفاق الإعلاني — كل الأرقام بالريال السعودي
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={metaAccountId}
            onChange={(event) => handleMetaChange(event.target.value)}
            disabled={loadingAccounts}
            style={{ minWidth: 240 }}
          >
            {metaAccounts.length === 0 ? (
              <option value="">لا يوجد حساب Meta</option>
            ) : (
              metaAccounts.map((account) => {
                const id = getAccountId(account);
                const currency =
                  account.currency || account.account_currency || "USD";

                return (
                  <option key={id} value={id}>
                    {getAccountName(account)} — {currency}
                  </option>
                );
              })
            )}
          </select>

          <select
            value={snapchatAccountId}
            onChange={(event) => handleSnapchatChange(event.target.value)}
            disabled={loadingAccounts}
            style={{ minWidth: 260 }}
          >
            {snapchatAccounts.length === 0 ? (
              <option value="">لا يوجد حساب Snapchat</option>
            ) : (
              snapchatAccounts.map((account) => {
                const id = getAccountId(account);
                const currency =
                  account.currency || account.account_currency || "USD";

                return (
                  <option key={id} value={id}>
                    {getAccountName(account)} — {currency}
                  </option>
                );
              })
            )}
          </select>

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

          <button
            className="dash-refresh"
            onClick={loadData}
            disabled={loadingData || loadingAccounts}
          >
            {loadingData ? "جاري التحميل..." : "تحديث ↺"}
          </button>
        </div>
      </div>

      {error && <div className="dash-message error">⚠ {error}</div>}

      {data?.note && <div className="dash-message warning">⚠ {data.note}</div>}

      <div className="dash-kpi-grid">
        <KPICard
          label="إجمالي المبيعات"
          value={loadingData ? "—" : formatSAR(summary.total_sales)}
          sub="سلة — كل المصادر"
          color="#06d6a0"
          icon="📦"
        />

        <KPICard
          label="مبيعات الإعلانات"
          value={loadingData ? "—" : formatSAR(summary.total_ads_sales)}
          sub="مبيعات منسوبة للإعلانات"
          color="#38bdf8"
          icon="📣"
        />

        <KPICard
          label="مبيعات عضوية / أخرى"
          value={loadingData ? "—" : formatSAR(summary.total_organic_sales)}
          sub="مبيعات بدون إعلانات"
          color="#8b5cf6"
          icon="🌱"
        />

        <KPICard
          label="إجمالي الإنفاق"
          value={loadingData ? "—" : formatSAR(summary.total_ads_spend)}
          sub="Meta + Snapchat"
          color="#f59e0b"
          icon="💳"
        />

        <KPICard
          label="ROAS الفعلي"
          value={loadingData ? "—" : formatROAS(summary.actual_roas)}
          sub="مبيعات سلة ÷ إنفاق إعلاني"
          color={roasColor(summary.actual_roas)}
          icon="📈"
        />

        <KPICard
          label="تكلفة الشراء"
          value={loadingData ? "—" : formatSAR(summary.cost_per_purchase)}
          sub="إنفاق ÷ عدد الطلبات"
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
          { key: "all", label: "الكل" },
          { key: "ads", label: "إعلانات" },
          { key: "organic", label: "عضوي" }
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
            <h2>أداء المصادر</h2>
            <p>
              {loadingData
                ? "جاري التحميل..."
                : `${filteredSources.length} مصادر • موحد بالريال السعودي`}
            </p>
          </div>
        </div>

        {loadingData ? (
          <div className="dash-empty">
            <h3>⏳ جاري تحميل البيانات...</h3>
          </div>
        ) : filteredSources.length === 0 ? (
          <div className="dash-empty">
            <h3>لا توجد بيانات</h3>
          </div>
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead>
                <tr>
                  <th>المصدر</th>
                  <th>الإنفاق ريال</th>
                  <th>الكليكات</th>
                  <th>الطلبات</th>
                  <th>تكلفة الشراء ريال</th>
                  <th>المبيعات ريال</th>
                  <th>ROAS</th>
                  <th>نسبة المبيعات</th>
                </tr>
              </thead>

              <tbody>
                {filteredSources.map((row) => {
                  const salesShare =
                    summary.total_sales > 0
                      ? (Number(row.sales || 0) / Number(summary.total_sales)) * 100
                      : 0;

                  return (
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
                          {row.source === "Total" ? "الإجمالي" : row.source}
                        </span>
                      </td>

                      <td>{formatSAR(row.spend)}</td>
                      <td>{formatNumber(row.clicks)}</td>
                      <td>{formatNumber(row.purchases)}</td>
                      <td>{formatSAR(row.cost_per_purchase)}</td>
                      <td>{formatSAR(row.sales)}</td>
                      <td style={{ color: roasColor(row.roas), fontWeight: 900 }}>
                        {formatROAS(row.roas)}
                      </td>
                      <td>{salesShare.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
                <tr>
                  <th>المصدر</th>
                  <th>الحالة</th>
                  <th>العملة</th>
                  <th>الخطأ</th>
                </tr>
              </thead>

              <tbody>
                {data.debug.map((row) => (
                  <tr key={row.source}>
                    <td>{row.source}</td>
                    <td>{row.success ? "✅ متصل" : "❌ مشكلة"}</td>
                    <td>{row.assumed_currency || "—"}</td>
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
