"use client";

import { useEffect, useMemo, useState } from "react";
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

const metricCards = [
  { key: "spend", label: "Spend", icon: "💰", format: "money" },
  { key: "purchase_value", label: "Revenue", icon: "💵", format: "money" },
  { key: "roas", label: "ROAS", icon: "📈", format: "number" },
  { key: "purchases", label: "Purchases", icon: "🛒", format: "number" },
  { key: "cpa", label: "CPA", icon: "🎯", format: "money" },
  { key: "add_to_cart", label: "Add To Cart", icon: "🛍️", format: "number" },
  { key: "initiate_checkout", label: "Checkout", icon: "💳", format: "number" },
  { key: "cost_per_add_to_cart", label: "Cost / ATC", icon: "📦", format: "money" },
  { key: "cost_per_initiate_checkout", label: "Cost / IC", icon: "⚡", format: "money" },
  { key: "ctr", label: "CTR", icon: "📊", format: "percent" }
];

function formatValue(value, type) {
  const num = Number(value || 0);
  if (type === "money") return `$${num.toFixed(2)}`;
  if (type === "percent") return `${num.toFixed(2)}%`;
  if (type === "number") return num.toLocaleString();
  return num.toLocaleString();
}

export default function DashboardPage({ defaultLevel = "campaign" }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [level, setLevel] = useState(defaultLevel);
  const [dateRange, setDateRange] = useState("maximum");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [sallaSummary, setSallaSummary] = useState(null);
  const [status, setStatus] = useState("Loading dashboard...");
  const [error, setError] = useState("");

  useEffect(() => {
    setLevel(defaultLevel);
  }, [defaultLevel]);

  useEffect(() => {
    loadAccountsAndDashboard();
    loadSallaSummary();
  }, []);

  useEffect(() => {
    if (accountId) {
      loadInsights(accountId, level, dateRange);
    }
  }, [accountId, level, dateRange]);

  async function loadAccountsAndDashboard() {
    try {
      setError("");
      setStatus("Loading Meta accounts...");

      const data = await apiGet("/api/meta/accounts");
      const list = data.data || [];

      setAccounts(list);

      const selected =
        list.find((account) => account.id === getSetting("primary_meta_account", ""))?.id ||
        list[0]?.id ||
        "";

      if (!selected) {
        setStatus("No Meta ad account selected");
        return;
      }

      setAccountId(selected);
      saveSetting("primary_meta_account", selected);
      setStatus("Account loaded");
    } catch (err) {
      setError(err.message || "Failed to load Meta accounts");
      setStatus("Connection error");
    }
  }

  async function loadInsights(
    selectedAccount = accountId,
    selectedLevel = level,
    selectedDateRange = dateRange
  ) {
    if (!selectedAccount) return;
    try {
      setError("");
      setStatus("Loading performance data...");
      let data = await apiGet(
        `/api/meta/insights?account_id=${selectedAccount}&level=${selectedLevel}&date_preset=${selectedDateRange}`
      );
      if (
        (!data.data || data.data.length === 0) &&
        selectedDateRange !== "maximum"
      ) {
        data = await apiGet(
          `/api/meta/insights?account_id=${selectedAccount}&level=${selectedLevel}&date_preset=maximum`
        );
        setDateRange("maximum");
      }
      setRows(data.data || []);
      setSummary(data.summary || null);
      setStatus(`${data.data?.length || 0} rows loaded successfully`);
    } catch (err) {
      setRows([]);
      setSummary(null);
      setError(err.message || "Failed to load insights");
      setStatus("Failed to load data");
    }
  }

  function changeAccount(value) {
    setAccountId(value);
    saveSetting("primary_meta_account", value);
    loadInsights(value, level, dateRange);
  }

  async function loadSallaSummary() {
    try {
      const data = await apiGet("/api/salla/summary");
      setSallaSummary(data);
    } catch (err) {
      console.error("Failed to load Salla summary", err);
    }
  }

  const rowTotals = useMemo(() => {
    const total = rows.reduce(
      (acc, row) => {
        acc.spend += Number(row.spend || 0);
        acc.impressions += Number(row.impressions || 0);
        acc.clicks += Number(row.clicks || 0);
        acc.reach += Number(row.reach || 0);
        acc.purchase_value += Number(row.purchase_value || 0);
        acc.purchases += Number(row.purchases || 0);
        acc.add_to_cart += Number(row.add_to_cart || 0);
        acc.initiate_checkout += Number(row.initiate_checkout || 0);
        return acc;
      },
      {
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        purchase_value: 0,
        purchases: 0,
        add_to_cart: 0,
        initiate_checkout: 0
      }
    );
    return {
      ...total,
      ctr: total.impressions ? (total.clicks / total.impressions) * 100 : 0,
      cpc: total.clicks ? total.spend / total.clicks : 0,
      cpm: total.impressions ? (total.spend / total.impressions) * 1000 : 0,
      roas: total.spend ? total.purchase_value / total.spend : 0,
      cpa: total.purchases ? total.spend / total.purchases : 0,
      cost_per_add_to_cart: total.add_to_cart
        ? total.spend / total.add_to_cart
        : 0,
      cost_per_initiate_checkout: total.initiate_checkout
        ? total.spend / total.initiate_checkout
        : 0
    };
  }, [rows]);
  const totals = summary || rowTotals;

  const nameKey =
    level === "ad"
      ? "ad_name"
      : level === "adset"
      ? "adset_name"
      : "campaign_name";

  const title =
    level === "ad"
      ? "Ads Performance"
      : level === "adset"
      ? "Ad Sets Performance"
      : "Campaigns Performance";

  const chartData = rows.slice(0, 8).map((row) => ({
    name: row[nameKey]?.slice(0, 22) || "Unknown",
    spend: Number(row.spend || 0),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0)
  }));

  return (
    <main className="dash-pro">
      <header className="dash-pro-header">
        <div>
          <span className="dash-badge">MetricsFlo Intelligence</span>
          <h1>Performance Dashboard</h1>
          <p>تحليل مباشر لأداء الحملات، الـ Ad Sets، والإعلانات من Meta Ads.</p>
        </div>

        <button
          className="dash-refresh"
          onClick={() => loadInsights(accountId, level, dateRange)}
        >
          Refresh Data
        </button>
      </header>

      <section className="dash-filter-grid">
        <div className="dash-filter-card">
          <label>Ad Account</label>

          <select value={accountId} onChange={(e) => changeAccount(e.target.value)}>
            {accounts.length === 0 && <option value="">No accounts loaded</option>}

            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name} - {acc.currency}
              </option>
            ))}
          </select>
        </div>

        <div className="dash-filter-card">
          <label>View Level</label>

          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="campaign">Campaigns</option>
            <option value="adset">Ad Sets</option>
            <option value="ad">Ads</option>
          </select>
        </div>

        <div className="dash-filter-card">
          <label>Date Range</label>

          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
              <option value="maximum">Maximum</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last_7d">Last 7 Days</option>
              <option value="last_30d">Last 30 Days</option>
              <option value="this_month">This Month</option>
            </select>
        </div>
      </section>

      <div className={error ? "dash-message error" : "dash-message success"}>
        {error || status}
      </div>

      <section className="dash-kpi-grid">
        {metricCards.map((item) => (
          <div className="dash-kpi-card" key={item.key}>
            <div className="dash-kpi-top">
              <span>{item.label}</span>
              <div>{item.icon}</div>
            </div>
            <strong>{formatValue(totals[item.key], item.format)}</strong>
          </div>
        ))}
      </section>

      {sallaSummary && (
        <section className="dash-kpi-grid">
          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>Salla Revenue</span>
              <div>🛒</div>
            </div>
            <strong>
              {Number(sallaSummary.total_revenue || 0).toLocaleString()} SAR
            </strong>
          </div>

          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>Real Orders</span>
              <div>📦</div>
            </div>
            <strong>{sallaSummary.total_orders || 0}</strong>
          </div>

          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>Average Order Value</span>
              <div>💳</div>
            </div>
            <strong>
              {Number(
                sallaSummary.average_order_value || 0
              ).toLocaleString()} SAR
            </strong>
          </div>

          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>Store Name</span>
              <div>🏪</div>
            </div>
            <strong>{sallaSummary.store_name}</strong>
          </div>
        </section>
      )}

      <section className="dash-insights-grid">
        <div className="dash-insight-card">
          <h3>Growth Read</h3>
          <p>
            Revenue: <strong>{formatValue(totals.purchase_value, "money")}</strong>{" "}
            | ROAS: <strong>{Number(totals.roas || 0).toFixed(2)}x</strong>{" "}
            | CPA: <strong>{formatValue(totals.cpa, "money")}</strong>{" "}
            | Purchases: <strong>{formatValue(totals.purchases, "number")}</strong>
          </p>
        </div>

        <div className="dash-insight-card">
          <h3>Decision Signal</h3>
          <p>
            {Number(totals.roas || 0) >= 3
              ? "SCALE: ROAS قوي. راقب Frequency و CPA قبل زيادة الميزانية."
              : Number(totals.roas || 0) >= 1.5
              ? "OPTIMIZE: الأداء متوسط. حسّن الكريتيف والفانل قبل التوسع."
              : "PAUSE / FIX: ROAS ضعيف. راجع العرض، الصفحة، والكريتيف قبل الصرف الإضافي."}
          </p>
        </div>
      </section>

      <section className="dash-chart-card">
        <div className="dash-chart-head">
          <div>
            <h2>Performance Overview</h2>
            <p>مقارنة سريعة بين أفضل العناصر حسب الإنفاق والكليكات.</p>
          </div>
        </div>

        <div className="dash-chart-box">
          {chartData.length === 0 ? (
            <div className="dash-empty">
              <h3>No chart data</h3>
              <p>لا توجد بيانات كافية لعرض الرسم البياني.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#24304f" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "#11162a",
                    border: "1px solid #2a3156",
                    borderRadius: "14px",
                    color: "#fff"
                  }}
                />
                <Bar dataKey="spend" fill="#6d5cff" radius={[8, 8, 0, 0]} />
                <Bar dataKey="clicks" fill="#22c55e" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="dash-insights-grid">
        <div className="dash-insight-card">
          <h3>Funnel Health</h3>
          <p>
            Clicks: <strong>{formatValue(totals.clicks, "number")}</strong> → ATC:{" "}
            <strong>{formatValue(totals.add_to_cart, "number")}</strong> → IC:{" "}
            <strong>{formatValue(totals.initiate_checkout, "number")}</strong> →
            Purchases: <strong>{formatValue(totals.purchases, "number")}</strong>
          </p>
        </div>
        <div className="dash-insight-card">
          <h3>Cost Efficiency</h3>
          <p>
            Cost / ATC:{" "}
            <strong>{formatValue(totals.cost_per_add_to_cart, "money")}</strong> |
            Cost / IC:{" "}
            <strong>{formatValue(totals.cost_per_initiate_checkout, "money")}</strong>
          </p>
        </div>
      </section>

      <section className="dash-table-card">
        <div className="dash-table-head">
          <div>
            <h2>{title}</h2>
            <p>{rows.length} rows loaded</p>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="dash-empty">
            <h3>No data yet</h3>
            <p>اختار حساب إعلاني من Connections أو اضغط Refresh Data لعرض البيانات.</p>
          </div>
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Spend</th>
                  <th>Revenue</th>
                  <th>ROAS</th>
                  <th>Purchases</th>
                  <th>CPA</th>
                  <th>ATC</th>
                  <th>IC</th>
                  <th>CTR</th>
                  <th>Decision</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => {
                  return (
                    <tr key={index}>
                      <td className="dash-name-cell">
                        {row[nameKey] || "Unknown"}
                      </td>
                      <td>{formatValue(row.spend, "money")}</td>
                      <td>{formatValue(row.purchase_value, "money")}</td>
                      <td>{Number(row.roas || 0).toFixed(2)}x</td>
                      <td>{formatValue(row.purchases, "number")}</td>
                      <td>{formatValue(row.cpa, "money")}</td>
                      <td>{formatValue(row.add_to_cart, "number")}</td>
                      <td>{formatValue(row.initiate_checkout, "number")}</td>
                      <td>{formatValue(row.ctr, "percent")}</td>
                      <td>{row.decision || "MAINTAIN"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
