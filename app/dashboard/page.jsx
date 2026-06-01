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
  { key: "impressions", label: "Impressions", icon: "👁️", format: "number" },
  { key: "clicks", label: "Clicks", icon: "🖱️", format: "number" },
  { key: "ctr", label: "CTR", icon: "📈", format: "percent" },
  { key: "cpc", label: "CPC", icon: "🎯", format: "money" },
  { key: "cpm", label: "CPM", icon: "📊", format: "money" }
];

function formatValue(value, type) {
  const num = Number(value || 0);

  if (type === "money") return `$${num.toFixed(2)}`;
  if (type === "percent") return `${num.toFixed(2)}%`;

  return num.toLocaleString();
}

export default function DashboardPage({
  defaultLevel = "campaign"
}) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [level, setLevel] = useState(defaultLevel);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("Loading dashboard...");
  const [error, setError] = useState("");

  useEffect(() => {
    setLevel(defaultLevel);
  }, [defaultLevel]);

  useEffect(() => {
    loadAccountsAndDashboard();
  }, []);

  useEffect(() => {
    if (accountId) {
      loadInsights(accountId, level);
    }
  }, [accountId, level]);
}
  async function loadAccountsAndDashboard() {
    try {
      setError("");
      setStatus("Loading Meta accounts...");

      const data = await apiGet("/api/meta/accounts");
      const list = data.data || [];

      setAccounts(list);

      const saved = getSetting("primary_meta_account", "");
      const selected = saved || list[0]?.id || "";

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

  async function loadInsights(selectedAccount = accountId, selectedLevel = level) {
    if (!selectedAccount) return;

    try {
      setError("");
      setStatus("Loading performance data...");

      const data = await apiGet(
        `/api/meta/insights?account_id=${selectedAccount}&level=${selectedLevel}`
      );

      setRows(data.data || []);
      setStatus("Dashboard updated successfully");
    } catch (err) {
      setRows([]);
      setError(err.message || "Failed to load insights");
      setStatus("Failed to load data");
    }
  }

  function changeAccount(value) {
    setAccountId(value);
    saveSetting("primary_meta_account", value);
  }

  const totals = useMemo(() => {
    const total = rows.reduce(
      (acc, row) => {
        acc.spend += Number(row.spend || 0);
        acc.impressions += Number(row.impressions || 0);
        acc.clicks += Number(row.clicks || 0);
        acc.reach += Number(row.reach || 0);
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, reach: 0 }
    );

    return {
      ...total,
      ctr: total.impressions ? (total.clicks / total.impressions) * 100 : 0,
      cpc: total.clicks ? total.spend / total.clicks : 0,
      cpm: total.impressions ? (total.spend / total.impressions) * 1000 : 0
    };
  }, [rows]);

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

        <button className="dash-refresh" onClick={() => loadInsights()}>
          Refresh Data
        </button>
      </header>

      <section className="dash-filter-grid">
        <div className="dash-filter-card">
          <label>Ad Account</label>

          <select
            value={accountId}
            onChange={(e) => changeAccount(e.target.value)}
          >
            {accounts.length === 0 && (
              <option value="">No accounts loaded</option>
            )}

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

      <section className="dash-insights-grid">
        <div className="dash-insight-card">
          <h3>Quick Read</h3>
          <p>
            إجمالي الإنفاق الحالي هو{" "}
            <strong>{formatValue(totals.spend, "money")}</strong> مع CTR قدره{" "}
            <strong>{formatValue(totals.ctr, "percent")}</strong>.
          </p>
        </div>

        <div className="dash-insight-card">
          <h3>Media Buyer Note</h3>
          <p>
            راقب الحملات ذات CPC مرتفع وCTR منخفض لأنها غالبًا تحتاج تعديل
            Creative أو Audience.
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
            <p>
              اختار حساب إعلاني من Connections أو اضغط Refresh Data لعرض
              البيانات.
            </p>
          </div>
        ) : (
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Spend</th>
                  <th>Impressions</th>
                  <th>Reach</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                  <th>CPC</th>
                  <th>CPM</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => {
                  const impressions = Number(row.impressions || 0);
                  const clicks = Number(row.clicks || 0);
                  const spend = Number(row.spend || 0);

                  const ctr = impressions ? (clicks / impressions) * 100 : 0;
                  const cpc = clicks ? spend / clicks : 0;
                  const cpm = impressions ? (spend / impressions) * 1000 : 0;

                  return (
                    <tr key={index}>
                      <td className="dash-name-cell">
                        {row[nameKey] || "Unknown"}
                      </td>
                      <td>{formatValue(spend, "money")}</td>
                      <td>{formatValue(impressions, "number")}</td>
                      <td>{formatValue(row.reach, "number")}</td>
                      <td>{formatValue(clicks, "number")}</td>
                      <td>{formatValue(ctr, "percent")}</td>
                      <td>{formatValue(cpc, "money")}</td>
                      <td>{formatValue(cpm, "money")}</td>
                    </tr>
                  );
                })}
              </tbody>
                 </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
