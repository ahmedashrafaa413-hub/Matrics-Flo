"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  SlidersHorizontal,
  RefreshCw,
  Download,
  TrendingUp,
  Megaphone,
  Leaf,
  Layers,
  BadgeDollarSign,
  Percent,
  Eye,
  ShoppingCart,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  CircleDot,
  Facebook,
  Ghost,
  Store,
  Sigma,
} from "lucide-react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import { formatSAR, formatNumber, formatROAS } from "../../lib/currency";

/* ─── Constants ─────────────────────────────────────────────────────────── */

const DATE_OPTIONS = [
  { value: "today",      label: "اليوم" },
  { value: "yesterday",  label: "أمس" },
  { value: "last_7d",    label: "آخر 7 أيام" },
  { value: "last_30d",   label: "آخر 30 يوم" },
  { value: "this_month", label: "هذا الشهر" },
  { value: "last_90d",   label: "آخر 90 يوم" },
  { value: "maximum",    label: "آخر 12 شهر" },
];

const TABS = [
  { key: "all",     label: "الكل" },
  { key: "ads",     label: "الإعلانات" },
  { key: "organic", label: "العضوي" },
  { key: "other",   label: "أخرى" },
];

const HOURLY_METRICS = [
  { key: "sales",    label: "المبيعات",  formatter: formatSAR },
  { key: "orders",   label: "الطلبات",   formatter: formatNumber },
  { key: "sessions", label: "الجلسات",   formatter: formatNumber },
];

/* ─── Account helpers ───────────────────────────────────────────────────── */

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

function normalizeAccounts(response) {
  const raw =
    response?.data || response?.accounts || response?.adaccounts || [];
  if (!Array.isArray(raw)) return [];
  const accounts = raw
    .map((item) => item?.account || item?.adaccount || item)
    .filter((item) => getAccountId(item));
  return Array.from(
    new Map(accounts.map((a) => [getAccountId(a), a])).values()
  );
}

/* ─── Formatting helpers ────────────────────────────────────────────────── */

function roasColor(value) {
  const roas = Number(value || 0);
  if (roas >= 5) return "var(--accent)";
  if (roas >= 2) return "#f7b84b";
  return "#ff5c8a";
}

function changePercent(currentValue, previousValue) {
  const current  = Number(currentValue  || 0);
  const previous = Number(previousValue || 0);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatUpdateTime(value) {
  if (!value) return "غير متاح";
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/* ─── Small components ──────────────────────────────────────────────────── */

function ChangeBadge({ current, previous }) {
  const change = changePercent(current, previous);
  if (change === null) {
    return <span className="perf-change neutral">جديد</span>;
  }
  const direction = change > 0 ? "up" : change < 0 ? "down" : "neutral";
  const Icon =
    change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`perf-change ${direction}`}>
      <Icon size={12} />
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

function ComparisonMetric({
  label,
  current,
  previous,
  formatter = formatNumber,
  unavailable = false,
}) {
  return (
    <article className="perf-compare-metric">
      <span className="perf-compare-label">{label}</span>
      <div className="perf-compare-result">
        <strong>{unavailable ? "—" : formatter(current)}</strong>
        {unavailable ? (
          <span className="perf-change neutral">GA4 غير متاح</span>
        ) : (
          <ChangeBadge current={current} previous={previous} />
        )}
      </div>
      <small>مقارنة بأمس</small>
    </article>
  );
}

function SourceIcon({ source }) {
  const name = String(source || "").toLowerCase();
  if (name.includes("meta"))     return <span className="perf-source-icon meta"><Facebook size={14} /></span>;
  if (name.includes("snapchat")) return <span className="perf-source-icon snapchat"><Ghost size={14} /></span>;
  if (name.includes("salla"))    return <span className="perf-source-icon salla"><Store size={14} /></span>;
  if (name.includes("total"))    return <span className="perf-source-icon total"><Sigma size={14} /></span>;
  return <span className="perf-source-icon default"><Layers size={14} /></span>;
}

/* ─── KPI skeleton ──────────────────────────────────────────────────────── */

function KPISkeleton() {
  return (
    <div className="perf-kpi-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="perf-kpi-card">
          <div className="skeleton" style={{ height: 14, width: "55%", marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 28, width: "70%", marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 12, width: "40%" }} />
        </div>
      ))}
    </div>
  );
}

/* ─── Hourly chart ──────────────────────────────────────────────────────── */

function HourlyChart({ rows, metric }) {
  const width   = 960;
  const height  = 260;
  const padding = { top: 22, right: 28, bottom: 38, left: 42 };

  const selected = HOURLY_METRICS.find((m) => m.key === metric) || HOURLY_METRICS[0];
  const todayValues     = rows.map((r) => Number(r[`today_${metric}`]     || 0));
  const yesterdayValues = rows.map((r) => Number(r[`yesterday_${metric}`] || 0));
  const max = Math.max(...todayValues, ...yesterdayValues, 1);

  const x = (hour)  => padding.left + (hour / 23) * (width - padding.left - padding.right);
  const y = (value) => padding.top  + (1 - value / max) * (height - padding.top - padding.bottom);
  const points = (values) =>
    values.map((v, h) => `${x(h).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <div className="perf-hourly-chart-wrap">
      <svg
        className="perf-hourly-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`مقارنة ${selected.label} بالساعة بين اليوم وأمس`}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const gridY = padding.top + ratio * (height - padding.top - padding.bottom);
          return (
            <line
              key={ratio}
              x1={padding.left}
              x2={width - padding.right}
              y1={gridY}
              y2={gridY}
              className="perf-chart-grid"
            />
          );
        })}

        <polyline points={points(yesterdayValues)} className="perf-chart-line yesterday" />
        <polyline points={points(todayValues)}     className="perf-chart-line today" />

        {[0, 4, 8, 12, 16, 20, 23].map((hour) => (
          <text key={hour} x={x(hour)} y={height - 12} className="perf-chart-label">
            {String(hour).padStart(2, "0")}:00
          </text>
        ))}
      </svg>

      <div className="perf-chart-legend">
        <span><i className="today" />اليوم</span>
        <span><i className="yesterday" />أمس</span>
        <strong>أعلى قيمة: {selected.formatter(max)}</strong>
      </div>
    </div>
  );
}

/* ─── Sparkline signal ──────────────────────────────────────────────────── */

function MetricSignal({ values, color = "#6366f1" }) {
  const points = useMemo(() => {
    const numeric = values.map(Number).filter(Number.isFinite);
    if (!numeric.length) return "4,32 116,32";
    const max = Math.max(...numeric, 1);
    const expanded = numeric.length === 1 ? [numeric[0], numeric[0]] : numeric;
    return expanded
      .map((v, i) => {
        const px = 4 + (i / Math.max(expanded.length - 1, 1)) * 112;
        const py = 48 - (v / max) * 38;
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);

  const gradId = `signal-${color.replace("#", "")}`;

  return (
    <svg
      className="perf-signal"
      viewBox="0 0 120 54"
      role="img"
      aria-label="توزيع القيمة بين مصادر البيانات"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─── KPI card ──────────────────────────────────────────────────────────── */

function KPICard({ label, value, values, color, hint, Icon, platform }) {
  return (
    <article className={`perf-kpi-card${platform ? ` ${platform}` : ""}`}>
      <div className="perf-kpi-top">
        <span className="perf-kpi-icon" style={{ color }}>
          <Icon size={16} />
        </span>
        <span className="perf-kpi-label">{label}</span>
      </div>
      <strong className="perf-kpi-value">{value}</strong>
      <div className="perf-kpi-bottom">
        <small className="perf-kpi-hint">{hint}</small>
        <MetricSignal values={values} color={color} />
      </div>
    </article>
  );
}

/* ─── CSV download ──────────────────────────────────────────────────────── */

function downloadCsv(rows) {
  const headers = [
    "Source", "Spend SAR", "Clicks", "Purchases",
    "Cost per purchase SAR", "Sales SAR", "ROAS",
  ];
  const lines = rows.map((row) =>
    [
      row.source, row.spend, row.clicks, row.purchases,
      row.cost_per_purchase, row.sales, row.roas,
    ]
      .map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`)
      .join(",")
  );
  const blob = new Blob(
    ["﻿", headers.join(","), "\n", lines.join("\n")],
    { type: "text/csv;charset=utf-8" }
  );
  const url    = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href     = url;
  anchor.download = `metricsflo-performance-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* ─── Main page ─────────────────────────────────────────────────────────── */

export default function PerformanceOverviewPage() {
  /* State */
  const [datePreset,        setDatePreset]        = useState("last_30d");
  const [metaAccounts,      setMetaAccounts]      = useState([]);
  const [snapchatAccounts,  setSnapchatAccounts]  = useState([]);
  const [metaAccountId,     setMetaAccountId]     = useState("");
  const [snapchatAccountId, setSnapchatAccountId] = useState("");
  const [data,              setData]              = useState(null);
  const [activeTab,         setActiveTab]         = useState("all");
  const [showFilters,       setShowFilters]       = useState(false);
  const [loadingAccounts,   setLoadingAccounts]   = useState(true);
  const [loadingData,       setLoadingData]       = useState(false);
  const [error,             setError]             = useState("");
  const [accountsError,     setAccountsError]     = useState("");
  const [comparison,        setComparison]        = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(true);
  const [liveUsers,         setLiveUsers]         = useState(null);
  const [hourlyData,        setHourlyData]        = useState(null);
  const [hourlyMetric,      setHourlyMetric]      = useState("sales");
  const [hourlyLoading,     setHourlyLoading]     = useState(true);

  /* Data loaders */
  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setAccountsError("");
    try {
      const [metaRes, snapRes] = await Promise.allSettled([
        apiGet("/api/meta/accounts"),
        apiGet("/api/snapchat/accounts"),
      ]);
      const nextMeta     = metaRes.status === "fulfilled" ? normalizeAccounts(metaRes.value)  : [];
      const nextSnapchat = snapRes.status === "fulfilled" ? normalizeAccounts(snapRes.value)  : [];
      const errors       = [];
      if (metaRes.status === "rejected") errors.push(`Meta: ${metaRes.reason?.message || "تعذر التحميل"}`);
      if (snapRes.status === "rejected") errors.push(`Snapchat: ${snapRes.reason?.message || "تعذر التحميل"}`);

      setMetaAccounts(nextMeta);
      setSnapchatAccounts(nextSnapchat);
      setAccountsError(errors.join(" • "));

      const meta    = nextMeta.find((a) => getAccountId(a) === getSetting("primary_meta_account", ""))    || nextMeta[0];
      const snap    = nextSnapchat.find((a) => getAccountId(a) === getSetting("primary_snapchat_account", "")) || nextSnapchat[0];
      const metaId  = meta ? getAccountId(meta) : "";
      const snapId  = snap ? getAccountId(snap) : "";

      setMetaAccountId(metaId);
      setSnapchatAccountId(snapId);
      if (metaId) saveSetting("primary_meta_account",     metaId);
      if (snapId) saveSetting("primary_snapchat_account", snapId);
    } catch (err) {
      setAccountsError(err.message || "تعذر تحميل الحسابات");
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    setError("");
    try {
      const params = new URLSearchParams({ date_preset: datePreset, salla_currency: "SAR" });
      if (metaAccountId)     params.set("meta_account_id",     metaAccountId);
      if (snapchatAccountId) params.set("snapchat_account_id", snapchatAccountId);
      setData(await apiGet(`/api/performance/overview?${params}`));
    } catch (err) {
      setError(err.message || "تعذر تحميل نظرة الأداء");
    } finally {
      setLoadingData(false);
    }
  }, [datePreset, metaAccountId, snapchatAccountId]);

  const performanceUrl = useCallback(
    (preset) => {
      const params = new URLSearchParams({ date_preset: preset, salla_currency: "SAR" });
      if (metaAccountId)     params.set("meta_account_id",     metaAccountId);
      if (snapchatAccountId) params.set("snapchat_account_id", snapchatAccountId);
      return `/api/performance/overview?${params}`;
    },
    [metaAccountId, snapchatAccountId]
  );

  const loadDailyComparison = useCallback(async () => {
    setComparisonLoading(true);
    const results = await Promise.allSettled([
      apiGet(performanceUrl("today")),
      apiGet(performanceUrl("yesterday")),
      apiGet("/api/ga/overview?range=today"),
      apiGet("/api/ga/overview?range=yesterday"),
    ]);
    const val = (i) => (results[i].status === "fulfilled" ? results[i].value : null);
    setComparison({
      today:       val(0)?.summary  || null,
      yesterday:   val(1)?.summary  || null,
      gaToday:     val(2)?.metrics  || null,
      gaYesterday: val(3)?.metrics  || null,
    });
    setComparisonLoading(false);
  }, [performanceUrl]);

  const loadRealtime = useCallback(async () => {
    try {
      const res         = await apiGet("/api/ga/realtime");
      const activeUsers = res?.realtime?.rows?.[0]?.metricValues?.[0]?.value;
      setLiveUsers(Number.isFinite(Number(activeUsers)) ? Number(activeUsers) : 0);
    } catch {
      setLiveUsers(null);
    }
  }, []);

  const loadHourlyData = useCallback(async () => {
    setHourlyLoading(true);
    try {
      setHourlyData(await apiGet("/api/performance/hourly"));
    } catch {
      setHourlyData(null);
    } finally {
      setHourlyLoading(false);
    }
  }, []);

  const refreshPage = useCallback(() => {
    loadData();
    loadDailyComparison();
    loadRealtime();
    loadHourlyData();
  }, [loadData, loadDailyComparison, loadRealtime, loadHourlyData]);

  /* Effects */
  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { if (!loadingAccounts) loadData(); }, [loadingAccounts, loadData]);
  useEffect(() => { if (!loadingAccounts) loadDailyComparison(); }, [loadingAccounts, loadDailyComparison]);
  useEffect(() => {
    loadRealtime();
    const id = window.setInterval(loadRealtime, 30_000);
    return () => window.clearInterval(id);
  }, [loadRealtime]);
  useEffect(() => { loadHourlyData(); }, [loadHourlyData]);

  /* Derived data */
  const summary    = data?.summary  || {};
  const sources    = data?.sources  || [];
  const sourceRows = useMemo(() => sources.filter((r) => r.source !== "Total"), [sources]);

  const filteredSources = useMemo(() => {
    if (activeTab === "all") return sources;
    const filtered = sourceRows.filter((r) => r.type === activeTab);
    const total    = sources.find((r) => r.source === "Total");
    return total && filtered.length ? [...filtered, total] : filtered;
  }, [activeTab, sourceRows, sources]);

  const metricValues = useMemo(() => ({
    total:   sourceRows.map((r) => r.sales),
    ads:     sourceRows.filter((r) => r.type === "ads").map((r) => r.sales),
    organic: sourceRows.filter((r) => r.type === "organic").map((r) => r.sales),
    other:   sourceRows.filter((r) => r.type === "other").map((r) => r.sales),
    spend:   sourceRows.filter((r) => r.type === "ads").map((r) => r.spend),
    roas:    sourceRows.filter((r) => r.type === "ads").map((r) => r.roas),
  }), [sourceRows]);

  const dateLabel = DATE_OPTIONS.find((o) => o.value === datePreset)?.label || "الفترة المحددة";

  /* ─── Render ─────────────────────────────────────────────────────────── */
  return (
    <main className="perf-page">

      {/* Toolbar */}
      <section className="perf-toolbar" aria-label="أدوات نظرة الأداء">

        <div className="perf-title">
          <LayoutDashboard size={20} className="perf-title-icon" />
          <h1>نظرة الأداء</h1>
        </div>

        <label className="perf-date-control">
          <CalendarDays size={15} />
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            disabled={loadingData}
          >
            {DATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <div className="perf-attribution">
          <TrendingUp size={14} />
          <span>Attribution المنصة</span>
        </div>

        <div className="perf-toolbar-actions">
          <button
            type="button"
            className={`perf-tool-btn${showFilters ? " active" : ""}`}
            onClick={() => setShowFilters((v) => !v)}
            title="الحسابات والفلاتر"
          >
            <SlidersHorizontal size={15} />
          </button>

          <button
            type="button"
            className="perf-tool-btn"
            onClick={refreshPage}
            disabled={loadingData || loadingAccounts}
            title="تحديث البيانات"
          >
            <RefreshCw size={15} className={loadingData ? "perf-spin" : ""} />
          </button>

          <span className="perf-live-dot" title="بيانات متصلة">
            <CircleDot size={14} />
          </span>
        </div>
      </section>

      {/* Account filters */}
      {showFilters && (
        <section className="perf-account-filters">
          <label>
            <span>حساب Meta</span>
            <select
              value={metaAccountId}
              onChange={(e) => {
                setMetaAccountId(e.target.value);
                saveSetting("primary_meta_account", e.target.value);
              }}
              disabled={loadingAccounts}
            >
              <option value="">لا يوجد حساب Meta</option>
              {metaAccounts.map((a) => (
                <option key={getAccountId(a)} value={getAccountId(a)}>
                  {getAccountName(a)} — {a.currency || a.account_currency || "USD"}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>حساب Snapchat</span>
            <select
              value={snapchatAccountId}
              onChange={(e) => {
                setSnapchatAccountId(e.target.value);
                saveSetting("primary_snapchat_account", e.target.value);
              }}
              disabled={loadingAccounts}
            >
              <option value="">لا يوجد حساب Snapchat</option>
              {snapchatAccounts.map((a) => (
                <option key={getAccountId(a)} value={getAccountId(a)}>
                  {getAccountName(a)} — {a.currency || a.account_currency || "USD"}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={loadAccounts}
            disabled={loadingAccounts}
          >
            {loadingAccounts ? "جاري تحميل الحسابات…" : "تحديث الحسابات"}
          </button>
        </section>
      )}

      {/* Error banners */}
      {accountsError && (
        <div className="dash-message error">⚠ {accountsError}</div>
      )}
      {error && (
        <div className="dash-message error">⚠ {error}</div>
      )}
      {data?.note && (
        <div className="dash-message warning">⚠ {data.note}</div>
      )}

      {/* Today vs Yesterday comparison strip */}
      <section className="perf-comparison-strip" aria-label="مقارنة اليوم بأمس">
        <header className="perf-comparison-heading">
          <span>كل القنوات</span>
          <strong>اليوم</strong>
          <small>مقارنة مباشرة بأمس</small>
        </header>

        {comparisonLoading ? (
          <div className="perf-compare-skeleton">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="perf-compare-metric">
                <div className="skeleton" style={{ height: 12, width: "60%", marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 22, width: "75%", marginBottom: 6 }} />
                <div className="skeleton" style={{ height: 10, width: "40%" }} />
              </div>
            ))}
          </div>
        ) : (
          <>
            <ComparisonMetric
              label="الجلسات"
              current={comparison?.gaToday?.sessions}
              previous={comparison?.gaYesterday?.sessions}
              unavailable={!comparison?.gaToday}
            />
            <ComparisonMetric
              label="إجمالي المبيعات"
              current={comparison?.today?.total_sales}
              previous={comparison?.yesterday?.total_sales}
              formatter={formatSAR}
              unavailable={!comparison?.today}
            />
            <ComparisonMetric
              label="متوسط قيمة الطلب"
              current={
                Number(comparison?.today?.total_purchases)
                  ? Number(comparison?.today?.total_sales || 0) /
                    Number(comparison.today.total_purchases)
                  : 0
              }
              previous={
                Number(comparison?.yesterday?.total_purchases)
                  ? Number(comparison?.yesterday?.total_sales || 0) /
                    Number(comparison.yesterday.total_purchases)
                  : 0
              }
              formatter={formatSAR}
              unavailable={!comparison?.today}
            />
            <ComparisonMetric
              label="معدل التحويل"
              current={comparison?.gaToday?.conversionRate}
              previous={comparison?.gaYesterday?.conversionRate}
              formatter={(v) => `${Number(v || 0).toFixed(2)}%`}
              unavailable={!comparison?.gaToday}
            />

            <article className="perf-compare-metric perf-live-users">
              <span className="perf-compare-label">المستخدمون النشطون الآن</span>
              <div className="perf-compare-result">
                <strong>{liveUsers === null ? "—" : formatNumber(liveUsers)}</strong>
                <span className="perf-realtime-status">
                  <i />
                  مباشر
                </span>
              </div>
              <small>يتحدث كل 30 ثانية من GA4</small>
            </article>
          </>
        )}
      </section>

      {/* Main content card */}
      <section className="perf-content-card">

        {/* KPI grid */}
        {loadingData ? (
          <KPISkeleton />
        ) : (
          <div className="perf-kpi-grid">
            <KPICard
              label="إجمالي المبيعات"
              value={formatSAR(summary.total_sales)}
              values={metricValues.total}
              color="#2870ff"
              hint="مبيعات سلة من كل المصادر"
              Icon={TrendingUp}
              platform="total"
            />
            <KPICard
              label="مبيعات الإعلانات"
              value={formatSAR(summary.total_ads_sales)}
              values={metricValues.ads}
              color="var(--meta)"
              hint="المبيعات المنسوبة لمنصات الإعلانات"
              Icon={Megaphone}
              platform="meta"
            />
            <KPICard
              label="المبيعات العضوية"
              value={formatSAR(summary.total_organic_sales)}
              values={metricValues.organic}
              color="var(--accent)"
              hint="مبيعات سلة غير المنسوبة للإعلانات"
              Icon={Leaf}
            />
            <KPICard
              label="مبيعات أخرى"
              value={formatSAR(summary.total_other_sales)}
              values={metricValues.other}
              color="#8b5cf6"
              hint="أي مصادر أخرى مسجلة"
              Icon={Layers}
            />
            <KPICard
              label="إجمالي الإنفاق الإعلاني"
              value={formatSAR(summary.total_ads_spend)}
              values={metricValues.spend}
              color="var(--snap)"
              hint="Meta وSnapchat موحدان بالريال"
              Icon={BadgeDollarSign}
              platform="snapchat"
            />
            <KPICard
              label="العائد التسويقي"
              value={`${(Number(summary.actual_roas || 0) * 100).toFixed(0)}%`}
              values={metricValues.roas}
              color={roasColor(summary.actual_roas)}
              hint="إجمالي المبيعات ÷ الإنفاق الإعلاني"
              Icon={Percent}
              platform="ga4"
            />
          </div>
        )}

        {/* Hourly chart */}
        <section className="perf-hourly-section" aria-label="الأداء بالساعة">
          <header className="perf-hourly-header">
            <div>
              <span>تحليل اليوم</span>
              <h2>اليوم مقابل أمس بالساعة</h2>
              <p>حسب توقيت الرياض — بيانات فعلية من Salla وGA4</p>
            </div>
            <div className="perf-hourly-tabs" role="group" aria-label="اختر المقياس">
              {HOURLY_METRICS.map((m) => (
                <button
                  type="button"
                  key={m.key}
                  className={hourlyMetric === m.key ? "active" : ""}
                  onClick={() => setHourlyMetric(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </header>

          {hourlyLoading ? (
            <div className="skeleton" style={{ height: 260, borderRadius: 16 }} />
          ) : hourlyData?.rows?.length ? (
            <HourlyChart rows={hourlyData.rows} metric={hourlyMetric} />
          ) : (
            <div className="perf-chart-empty">تعذر تحميل بيانات المقارنة بالساعة</div>
          )}

          <footer className="perf-source-freshness">
            <div className={hourlyData?.sources?.salla?.success ? "connected" : "unavailable"}>
              <span><i /> Salla</span>
              <strong>
                {hourlyData?.sources?.salla?.success
                  ? `آخر جلب ${formatUpdateTime(hourlyData.sources.salla.fetched_at)}`
                  : "غير متصل"}
              </strong>
            </div>
            <div className={hourlyData?.sources?.ga4?.success ? "connected" : "unavailable"}>
              <span><i /> Google Analytics</span>
              <strong>
                {hourlyData?.sources?.ga4?.success
                  ? `آخر جلب ${formatUpdateTime(hourlyData.sources.ga4.fetched_at)}`
                  : "غير متصل"}
              </strong>
            </div>
          </footer>
        </section>

        {/* Source table with tabs */}
        <div className="perf-section-bar">
          <nav className="perf-tabs" aria-label="فلترة نوع المصدر">
            {TABS.map((tab) => (
              <button
                type="button"
                key={tab.key}
                className={activeTab === tab.key ? "active" : ""}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            className="perf-download"
            onClick={() => downloadCsv(filteredSources)}
            disabled={!filteredSources.length}
            title="تحميل CSV"
          >
            <Download size={14} />
            <span>CSV</span>
          </button>
        </div>

        <div className="perf-table-wrap">
          {loadingData ? (
            <div className="perf-empty">
              <div className="skeleton" style={{ height: 14, width: "40%", marginBottom: 10 }} />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 44, marginBottom: 6, borderRadius: 8 }} />
              ))}
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="perf-empty">لا توجد بيانات في هذا التصنيف</div>
          ) : (
            <table className="perf-table">
              <thead>
                <tr>
                  <th>المصدر</th>
                  <th>الإنفاق</th>
                  <th>النقرات</th>
                  <th>المشتريات</th>
                  <th>تكلفة الشراء</th>
                  <th>المبيعات</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {filteredSources.map((row) => (
                  <tr
                    key={`${activeTab}-${row.source}`}
                    className={row.source === "Total" ? "total" : ""}
                  >
                    <td>
                      <SourceIcon source={row.source} />
                      <span>{row.source === "Total" ? "الإجمالي" : row.source}</span>
                    </td>
                    <td>{formatSAR(row.spend)}</td>
                    <td>{formatNumber(row.clicks)}</td>
                    <td>{formatNumber(row.purchases)}</td>
                    <td>{formatSAR(row.cost_per_purchase)}</td>
                    <td>{formatSAR(row.sales)}</td>
                    <td style={{ color: roasColor(row.roas) }}>
                      {formatROAS(row.roas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Diagnostics accordion */}
      {data?.debug?.some((r) => !r.success) && (
        <details className="perf-diagnostics">
          <summary>حالة مصادر البيانات</summary>
          {data.debug.map((r) => (
            <p key={r.source}>
              <strong>{r.source}:</strong>{" "}
              {r.success ? "متصل" : r.error || "مشكلة في الاتصال"}
            </p>
          ))}
        </details>
      )}
    </main>
  );
}
