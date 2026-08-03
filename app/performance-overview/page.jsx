"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  { value: "maximum", label: "آخر 12 شهر" }
];

const TABS = [
  { key: "all", label: "الكل" },
  { key: "ads", label: "الإعلانات" },
  { key: "organic", label: "العضوي" },
  { key: "other", label: "أخرى" }
];

function getAccountId(account) {
  return account?.id || account?.account_id || account?.ad_account_id || account?.snapchat_account_id || account?.adaccount_id || "";
}

function getAccountName(account) {
  return account?.name || account?.account_name || account?.business_name || account?.organization_name || "Account";
}

function normalizeAccounts(response) {
  const raw = response?.data || response?.accounts || response?.adaccounts || [];
  if (!Array.isArray(raw)) return [];
  const accounts = raw.map((item) => item?.account || item?.adaccount || item).filter((item) => getAccountId(item));
  return Array.from(new Map(accounts.map((account) => [getAccountId(account), account])).values());
}

function roasColor(value) {
  const roas = Number(value || 0);
  if (roas >= 5) return "#19d3a2";
  if (roas >= 2) return "#f7b84b";
  return "#ff5c8a";
}

function changePercent(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function ChangeBadge({ current, previous }) {
  const change = changePercent(current, previous);
  if (change === null) return <span className="perf-change neutral">جديد</span>;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "neutral";
  const arrow = change > 0 ? "↑" : change < 0 ? "↓" : "—";
  return <span className={`perf-change ${direction}`}>{arrow} {Math.abs(change).toFixed(1)}%</span>;
}

function ComparisonMetric({ label, current, previous, formatter = formatNumber, unavailable = false }) {
  return (
    <article className="perf-compare-metric">
      <span className="perf-compare-label">{label}</span>
      <div className="perf-compare-result">
        <strong>{unavailable ? "—" : formatter(current)}</strong>
        {unavailable ? <span className="perf-change neutral">GA4 غير متاح</span> : <ChangeBadge current={current} previous={previous} />}
      </div>
      <small>مقارنة بأمس</small>
    </article>
  );
}

function MetricSignal({ values, color = "#6366f1" }) {
  const points = useMemo(() => {
    const numeric = values.map(Number).filter(Number.isFinite);
    if (!numeric.length) return "4,32 116,32";
    const max = Math.max(...numeric, 1);
    const expanded = numeric.length === 1 ? [numeric[0], numeric[0]] : numeric;
    return expanded.map((value, index) => {
      const x = 4 + (index / Math.max(expanded.length - 1, 1)) * 112;
      const y = 48 - (value / max) * 38;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [values]);

  return (
    <svg className="perf-signal" viewBox="0 0 120 54" role="img" aria-label="توزيع القيمة بين مصادر البيانات">
      <defs>
        <linearGradient id={`signal-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KPICard({ label, value, values, color, hint }) {
  return (
    <article className="perf-kpi-card">
      <div className="perf-kpi-copy">
        <span className="perf-kpi-label">{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
      <MetricSignal values={values} color={color} />
      <span className="perf-info" title={hint} aria-label={hint}>i</span>
    </article>
  );
}

function SourceIcon({ source }) {
  const name = String(source || "").toLowerCase();
  let icon = "◫", className = "default";
  if (name.includes("meta")) { icon = "f"; className = "meta"; }
  if (name.includes("snapchat")) { icon = "👻"; className = "snapchat"; }
  if (name.includes("salla")) { icon = "س"; className = "salla"; }
  if (name.includes("total")) { icon = "Σ"; className = "total"; }
  return <span className={`perf-source-icon ${className}`}>{icon}</span>;
}

function downloadCsv(rows) {
  const headers = ["Source", "Spend SAR", "Clicks", "Purchases", "Cost per purchase SAR", "Sales SAR", "ROAS"];
  const lines = rows.map((row) => [row.source, row.spend, row.clicks, row.purchases, row.cost_per_purchase, row.sales, row.roas]
    .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
  const blob = new Blob(["\uFEFF", headers.join(","), "\n", lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `metricsflo-performance-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PerformanceOverviewPage() {
  const [datePreset, setDatePreset] = useState("last_30d");
  const [metaAccounts, setMetaAccounts] = useState([]);
  const [snapchatAccounts, setSnapchatAccounts] = useState([]);
  const [metaAccountId, setMetaAccountId] = useState("");
  const [snapchatAccountId, setSnapchatAccountId] = useState("");
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [showFilters, setShowFilters] = useState(true);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");
  const [accountsError, setAccountsError] = useState("");
  const [comparison, setComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(true);
  const [liveUsers, setLiveUsers] = useState(null);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setAccountsError("");
    try {
      const [metaResponse, snapchatResponse] = await Promise.allSettled([
        apiGet("/api/meta/accounts"),
        apiGet("/api/snapchat/accounts")
      ]);
      const nextMeta = metaResponse.status === "fulfilled" ? normalizeAccounts(metaResponse.value) : [];
      const nextSnapchat = snapchatResponse.status === "fulfilled" ? normalizeAccounts(snapchatResponse.value) : [];
      const errors = [];
      if (metaResponse.status === "rejected") errors.push(`Meta: ${metaResponse.reason?.message || "تعذر التحميل"}`);
      if (snapchatResponse.status === "rejected") errors.push(`Snapchat: ${snapchatResponse.reason?.message || "تعذر التحميل"}`);
      setMetaAccounts(nextMeta);
      setSnapchatAccounts(nextSnapchat);
      setAccountsError(errors.join(" • "));

      const meta = nextMeta.find((account) => getAccountId(account) === getSetting("primary_meta_account", "")) || nextMeta[0];
      const snap = nextSnapchat.find((account) => getAccountId(account) === getSetting("primary_snapchat_account", "")) || nextSnapchat[0];
      const nextMetaId = meta ? getAccountId(meta) : "";
      const nextSnapId = snap ? getAccountId(snap) : "";
      setMetaAccountId(nextMetaId);
      setSnapchatAccountId(nextSnapId);
      if (nextMetaId) saveSetting("primary_meta_account", nextMetaId);
      if (nextSnapId) saveSetting("primary_snapchat_account", nextSnapId);
    } catch (requestError) {
      setAccountsError(requestError.message || "تعذر تحميل الحسابات");
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    setError("");
    try {
      const params = new URLSearchParams({ date_preset: datePreset, salla_currency: "SAR" });
      if (metaAccountId) params.set("meta_account_id", metaAccountId);
      if (snapchatAccountId) params.set("snapchat_account_id", snapchatAccountId);
      setData(await apiGet(`/api/performance/overview?${params.toString()}`));
    } catch (requestError) {
      setError(requestError.message || "تعذر تحميل نظرة الأداء");
    } finally {
      setLoadingData(false);
    }
  }, [datePreset, metaAccountId, snapchatAccountId]);

  const performanceUrl = useCallback((preset) => {
    const params = new URLSearchParams({ date_preset: preset, salla_currency: "SAR" });
    if (metaAccountId) params.set("meta_account_id", metaAccountId);
    if (snapchatAccountId) params.set("snapchat_account_id", snapchatAccountId);
    return `/api/performance/overview?${params.toString()}`;
  }, [metaAccountId, snapchatAccountId]);

  const loadDailyComparison = useCallback(async () => {
    setComparisonLoading(true);
    const results = await Promise.allSettled([
      apiGet(performanceUrl("today")),
      apiGet(performanceUrl("yesterday")),
      apiGet("/api/ga/overview?range=today"),
      apiGet("/api/ga/overview?range=yesterday")
    ]);
    const value = (index) => results[index].status === "fulfilled" ? results[index].value : null;
    setComparison({
      today: value(0)?.summary || null,
      yesterday: value(1)?.summary || null,
      gaToday: value(2)?.metrics || null,
      gaYesterday: value(3)?.metrics || null
    });
    setComparisonLoading(false);
  }, [performanceUrl]);

  const loadRealtime = useCallback(async () => {
    try {
      const response = await apiGet("/api/ga/realtime");
      const activeUsers = response?.realtime?.rows?.[0]?.metricValues?.[0]?.value;
      setLiveUsers(Number.isFinite(Number(activeUsers)) ? Number(activeUsers) : 0);
    } catch {
      setLiveUsers(null);
    }
  }, []);

  const refreshPage = useCallback(() => {
    loadData();
    loadDailyComparison();
    loadRealtime();
  }, [loadDailyComparison, loadData, loadRealtime]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { if (!loadingAccounts) loadData(); }, [loadingAccounts, loadData]);
  useEffect(() => { if (!loadingAccounts) loadDailyComparison(); }, [loadingAccounts, loadDailyComparison]);
  useEffect(() => {
    loadRealtime();
    const intervalId = window.setInterval(loadRealtime, 30000);
    return () => window.clearInterval(intervalId);
  }, [loadRealtime]);

  const summary = data?.summary || {};
  const sources = data?.sources || [];
  const sourceRows = useMemo(() => sources.filter((row) => row.source !== "Total"), [sources]);
  const filteredSources = useMemo(() => {
    if (activeTab === "all") return sources;
    const filtered = sourceRows.filter((row) => row.type === activeTab);
    const total = sources.find((row) => row.source === "Total");
    return total && filtered.length ? [...filtered, total] : filtered;
  }, [activeTab, sourceRows, sources]);

  const metricValues = useMemo(() => ({
    total: sourceRows.map((row) => row.sales),
    ads: sourceRows.filter((row) => row.type === "ads").map((row) => row.sales),
    organic: sourceRows.filter((row) => row.type === "organic").map((row) => row.sales),
    other: sourceRows.filter((row) => row.type === "other").map((row) => row.sales),
    spend: sourceRows.filter((row) => row.type === "ads").map((row) => row.spend),
    roas: sourceRows.filter((row) => row.type === "ads").map((row) => row.roas)
  }), [sourceRows]);

  const dateLabel = DATE_OPTIONS.find((option) => option.value === datePreset)?.label || "الفترة المحددة";

  return (
    <main className="perf-page" dir="rtl">
      <section className="perf-toolbar" aria-label="أدوات نظرة الأداء">
        <div className="perf-title"><span className="perf-dashboard-icon">◧</span><h1>نظرة الأداء</h1></div>
        <label className="perf-date-control"><span>▣</span><select value={datePreset} onChange={(event) => setDatePreset(event.target.value)} disabled={loadingData}>{DATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <div className="perf-attribution"><span className="perf-bars">▂▅▇</span><span>Attribution المنصة</span></div>
        <div className="perf-toolbar-actions">
          <button type="button" className={showFilters ? "active" : ""} onClick={() => setShowFilters((value) => !value)} title="الحسابات والفلاتر" aria-label="الحسابات والفلاتر">☷</button>
          <button type="button" onClick={refreshPage} disabled={loadingData || loadingAccounts} title="تحديث البيانات" aria-label="تحديث البيانات">{loadingData ? "…" : "↻"}</button>
          <span className="perf-live-dot" title="بيانات متصلة">●</span>
        </div>
      </section>

      {showFilters ? (
        <section className="perf-account-filters">
          <label><span>حساب Meta</span><select value={metaAccountId} onChange={(event) => { setMetaAccountId(event.target.value); saveSetting("primary_meta_account", event.target.value); }} disabled={loadingAccounts}><option value="">لا يوجد حساب Meta</option>{metaAccounts.map((account) => <option key={getAccountId(account)} value={getAccountId(account)}>{getAccountName(account)} — {account.currency || account.account_currency || "USD"}</option>)}</select></label>
          <label><span>حساب Snapchat</span><select value={snapchatAccountId} onChange={(event) => { setSnapchatAccountId(event.target.value); saveSetting("primary_snapchat_account", event.target.value); }} disabled={loadingAccounts}><option value="">لا يوجد حساب Snapchat</option>{snapchatAccounts.map((account) => <option key={getAccountId(account)} value={getAccountId(account)}>{getAccountName(account)} — {account.currency || account.account_currency || "USD"}</option>)}</select></label>
          <button type="button" onClick={loadAccounts} disabled={loadingAccounts}>{loadingAccounts ? "جاري تحميل الحسابات…" : "تحديث الحسابات"}</button>
        </section>
      ) : null}

      {accountsError ? <div className="dash-message error">⚠ {accountsError}</div> : null}
      {error ? <div className="dash-message error">⚠ {error}</div> : null}
      {data?.note ? <div className="dash-message warning">⚠ {data.note}</div> : null}

      <section className="perf-comparison-strip" aria-label="مقارنة اليوم بأمس">
        <header className="perf-comparison-heading">
          <span>كل القنوات</span>
          <strong>اليوم</strong>
          <small>مقارنة مباشرة بأمس</small>
        </header>
        <ComparisonMetric label="الجلسات" current={comparison?.gaToday?.sessions} previous={comparison?.gaYesterday?.sessions} unavailable={!comparisonLoading && !comparison?.gaToday} />
        <ComparisonMetric label="إجمالي المبيعات" current={comparison?.today?.total_sales} previous={comparison?.yesterday?.total_sales} formatter={formatSAR} unavailable={!comparisonLoading && !comparison?.today} />
        <ComparisonMetric label="متوسط قيمة الطلب" current={Number(comparison?.today?.total_purchases) ? Number(comparison?.today?.total_sales || 0) / Number(comparison.today.total_purchases) : 0} previous={Number(comparison?.yesterday?.total_purchases) ? Number(comparison?.yesterday?.total_sales || 0) / Number(comparison.yesterday.total_purchases) : 0} formatter={formatSAR} unavailable={!comparisonLoading && !comparison?.today} />
        <ComparisonMetric label="معدل التحويل" current={comparison?.gaToday?.conversionRate} previous={comparison?.gaYesterday?.conversionRate} formatter={(value) => `${Number(value || 0).toFixed(2)}%`} unavailable={!comparisonLoading && !comparison?.gaToday} />
        <article className="perf-compare-metric perf-live-users">
          <span className="perf-compare-label">المستخدمون النشطون الآن</span>
          <div className="perf-compare-result"><strong>{liveUsers === null ? "—" : formatNumber(liveUsers)}</strong><span className="perf-realtime-status"><i /> مباشر</span></div>
          <small>يتحدث كل 30 ثانية من GA4</small>
        </article>
      </section>

      <section className="perf-content-card">
        <div className="perf-kpi-grid">
          <KPICard label="إجمالي المبيعات" value={loadingData ? "—" : formatSAR(summary.total_sales)} values={metricValues.total} color="#2870ff" hint="مبيعات سلة من كل المصادر" />
          <KPICard label="مبيعات الإعلانات" value={loadingData ? "—" : formatSAR(summary.total_ads_sales)} values={metricValues.ads} color="#2870ff" hint="المبيعات المنسوبة لمنصات الإعلانات" />
          <KPICard label="المبيعات العضوية" value={loadingData ? "—" : formatSAR(summary.total_organic_sales)} values={metricValues.organic} color="#19d3a2" hint="مبيعات سلة غير المنسوبة للإعلانات" />
          <KPICard label="مبيعات أخرى" value={loadingData ? "—" : formatSAR(summary.total_other_sales)} values={metricValues.other} color="#8b5cf6" hint="أي مصادر أخرى مسجلة" />
          <KPICard label="إجمالي الإنفاق الإعلاني" value={loadingData ? "—" : formatSAR(summary.total_ads_spend)} values={metricValues.spend} color="#f7b84b" hint="Meta وSnapchat موحدان بالريال" />
          <KPICard label="العائد التسويقي" value={loadingData ? "—" : `${(Number(summary.actual_roas || 0) * 100).toFixed(0)}%`} values={metricValues.roas} color={roasColor(summary.actual_roas)} hint="إجمالي المبيعات ÷ الإنفاق الإعلاني" />
        </div>

        <div className="perf-section-bar">
          <nav className="perf-tabs" aria-label="فلترة نوع المصدر">{TABS.map((tab) => <button type="button" key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}</nav>
          <button type="button" className="perf-download" onClick={() => downloadCsv(filteredSources)} disabled={!filteredSources.length} title="تحميل CSV" aria-label="تحميل CSV">⇩</button>
        </div>

        <div className="perf-table-wrap">
          {loadingData ? <div className="perf-empty">جاري تحميل بيانات {dateLabel}…</div> : filteredSources.length === 0 ? <div className="perf-empty">لا توجد بيانات في هذا التصنيف</div> : (
            <table className="perf-table">
              <thead><tr><th>المصدر</th><th>الإنفاق</th><th>النقرات</th><th>المشتريات</th><th>تكلفة الشراء</th><th>المبيعات</th><th>ROAS</th></tr></thead>
              <tbody>{filteredSources.map((row) => <tr key={`${activeTab}-${row.source}`} className={row.source === "Total" ? "total" : ""}><td><SourceIcon source={row.source} /><span>{row.source === "Total" ? "الإجمالي" : row.source}</span></td><td>{formatSAR(row.spend)}</td><td>{formatNumber(row.clicks)}</td><td>{formatNumber(row.purchases)}</td><td>{formatSAR(row.cost_per_purchase)}</td><td>{formatSAR(row.sales)}</td><td style={{ color: roasColor(row.roas) }}>{formatROAS(row.roas)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </section>

      {data?.debug?.some((row) => !row.success) ? <details className="perf-diagnostics"><summary>حالة مصادر البيانات</summary>{data.debug.map((row) => <p key={row.source}><strong>{row.source}:</strong> {row.success ? "متصل" : row.error || "مشكلة في الاتصال"}</p>)}</details> : null}
    </main>
  );
}
