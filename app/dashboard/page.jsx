"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import { rankCreatives, scoringSummary } from "../../lib/creativeScoring";
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
  const [alerts, setAlerts] = useState([]);
  const [funnelDiagnosis, setFunnelDiagnosis] = useState([]);
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

  function generateAlerts(summary) {
    const nextAlerts = [];
    if (!summary) return nextAlerts;
    const roas = Number(summary.roas || 0);
    const cpa = Number(summary.cpa || 0);
    const ctr = Number(summary.ctr || 0);
    const cpc = Number(summary.cpc || 0);
    const cpm = Number(summary.cpm || 0);
    const spend = Number(summary.spend || 0);
    const revenue = Number(summary.purchase_value || 0);
    const purchases = Number(summary.purchases || 0);
    const addToCart = Number(summary.add_to_cart || 0);
    const initiateCheckout = Number(summary.initiate_checkout || 0);
    if (spend > 0 && revenue < spend) {
      nextAlerts.push({
        severity: "high",
        title: "ROAS below profitability threshold",
        message: "Ad spend is higher than tracked purchase value.",
        cause: "Likely weak conversion rate, low AOV, poor offer, or tracking gap.",
        action: "Pause the weakest campaigns and review funnel conversion before scaling.",
        ice: 27
      });
    }
    if (roas > 0 && roas < 1) {
      nextAlerts.push({
        severity: "high",
        title: "ROAS below 1",
        message: "Campaigns are likely unprofitable based on tracked revenue.",
        cause: "Low purchase value, weak conversion rate, or expensive traffic.",
        action: "Reduce budget on low ROAS campaigns and test stronger offer/landing page.",
        ice: 26
      });
    }
    if (ctr > 0 && ctr < 1) {
      nextAlerts.push({
        severity: "medium",
        title: "CTR below 1%",
        message: "Ads are not generating enough interest from the audience.",
        cause: "Weak hook, creative fatigue, wrong audience, or unclear value proposition.",
        action: "Launch 3 new creatives with stronger hooks and Saudi-market messaging.",
        ice: 24
      });
    }
    if (cpa > 0 && purchases > 0 && roas < 2) {
      nextAlerts.push({
        severity: "medium",
        title: "CPA pressure detected",
        message: "Cost per purchase is high compared to current return.",
        cause: "Funnel inefficiency or campaign targeting is too broad.",
        action: "Optimize campaigns with high CPA and prioritize best converting segments.",
        ice: 22
      });
    }
    if (addToCart > 0 && purchases > 0) {
      const cartAbandonment = ((addToCart - purchases) / addToCart) * 100;
      if (cartAbandonment > 80) {
        nextAlerts.push({
          severity: "medium",
          title: "High cart abandonment",
          message: `Cart abandonment is ${cartAbandonment.toFixed(1)}%.`,
          cause: "Checkout friction, shipping cost, payment issue, or weak urgency.",
          action: "Review checkout, payment options, delivery promise, and retarget cart abandoners.",
          ice: 23
        });
      }
    }
    if (addToCart > 0 && initiateCheckout > 0) {
      const checkoutDrop = ((addToCart - initiateCheckout) / addToCart) * 100;
      if (checkoutDrop > 60) {
        nextAlerts.push({
          severity: "medium",
          title: "Drop-off before checkout",
          message: `Only ${((initiateCheckout / addToCart) * 100).toFixed(1)}% of carts start checkout.`,
          cause: "Product page trust, price objection, unclear offer, or delivery concerns.",
          action: "Improve product page proof, offer visibility, reviews, and CTA clarity.",
          ice: 21
        });
      }
    }
    if (roas >= 3 && ctr >= 1 && purchases >= 5) {
      nextAlerts.push({
        severity: "success",
        title: "Scaling opportunity",
        message: "ROAS, CTR, and purchase volume indicate possible scaling potential.",
        cause: "Strong offer-market fit and healthy acquisition performance.",
        action: "Increase budget gradually by 15–20% while monitoring CPA and frequency.",
        ice: 25
      });
    }
    if (nextAlerts.length === 0) {
      nextAlerts.push({
        severity: "neutral",
        title: "No critical alerts",
        message: "Performance is stable based on current available data.",
        cause: "No major profitability, acquisition, or funnel risk detected.",
        action: "Continue monitoring and test new creatives proactively.",
        ice: 10
      });
    }
    return nextAlerts.sort((a, b) => b.ice - a.ice);
  }

  function diagnoseFunnel(summary) {
    const issues = [];
    if (!summary) return issues;
    const lpvRate = Number(summary.lpv_rate || 0);
    const atcRate = Number(summary.atc_rate || 0);
    const checkoutRate = Number(summary.checkout_rate || 0);
    const purchaseRate = Number(summary.purchase_rate || 0);
    const cartAbandonmentRate = Number(summary.cart_abandonment_rate || 0);
    if (lpvRate > 0 && lpvRate < 70) {
      issues.push({
        stage: "Link Clicks → Landing Page Views",
        problem: "Users click the ad but do not reach the landing page.",
        cause: "Slow loading speed, redirect issue, tracking issue, or poor mobile experience.",
        action: "Run PageSpeed test, check mobile loading, test links, and compare Meta clicks with GA4 sessions."
      });
    }
    if (atcRate > 0 && atcRate < 8) {
      issues.push({
        stage: "Landing Page / Content View → Add To Cart",
        problem: "Users arrive but do not add products to cart.",
        cause: "Weak offer, poor product page trust, unclear pricing, weak CTA, or product mismatch.",
        action: "Improve product page, add reviews/social proof, clarify offer, shipping, guarantees, and CTA."
      });
    }
    if (checkoutRate > 0 && checkoutRate < 40) {
      issues.push({
        stage: "Add To Cart → Initiate Checkout",
        problem: "Users add to cart but do not start checkout.",
        cause: "Cart UX issue, shipping surprise, weak urgency, or lack of payment clarity.",
        action: "Audit cart page, show delivery/payment info earlier, and add cart abandonment retargeting."
      });
    }
    if (purchaseRate > 0 && purchaseRate < 30) {
      issues.push({
        stage: "Initiate Checkout → Purchase",
        problem: "Users start checkout but do not complete purchase.",
        cause: "Payment failure, coupon issue, hidden costs, delivery concerns, or checkout friction.",
        action: "Test full purchase flow, payment methods, discount codes, shipping fees, and checkout UX."
      });
    }
    if (cartAbandonmentRate > 80) {
      issues.push({
        stage: "Cart Abandonment",
        problem: `Cart abandonment is high at ${cartAbandonmentRate.toFixed(1)}%.`,
        cause: "Price objection, shipping cost, payment friction, or weak urgency.",
        action: "Launch ATC retargeting, improve offer clarity, add urgency, and test free shipping threshold."
      });
    }
    if (issues.length === 0) {
      issues.push({
        stage: "Funnel Health",
        problem: "No major funnel bottleneck detected from available data.",
        cause: "The funnel appears stable based on current thresholds.",
        action: "Keep monitoring and compare results by campaign, ad set, and ad level."
      });
    }
    return issues;
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
      setAlerts(generateAlerts(data.summary));
      setFunnelDiagnosis(diagnoseFunnel(data.summary));
      setStatus(`${data.data?.length || 0} rows loaded successfully`);
    } catch (err) {
      setRows([]);
      setSummary(null);
      setAlerts([]);
      setFunnelDiagnosis([]);
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

  const creativeSummary = useMemo(() => {
    if (level !== "ad" || !rows.length) return null;
    const ranked = rankCreatives(rows, "ad_name");
    return scoringSummary(ranked);
  }, [rows, level]);

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

      {alerts.length > 0 && (
        <section className="dash-insights-grid">
          {alerts.slice(0, 3).map((alert, index) => (
            <div className="dash-insight-card" key={index}>
              <h3>
                {alert.severity === "high"
                  ? "🔴"
                  : alert.severity === "medium"
                  ? "🟠"
                  : alert.severity === "success"
                  ? "🟢"
                  : "⚪"}{" "}
                {alert.title}
              </h3>
              <p>
                <strong>What happened:</strong> {alert.message}
              </p>
              <p>
                <strong>Likely cause:</strong> {alert.cause}
              </p>
              <p>
                <strong>Recommended action:</strong> {alert.action}
              </p>
              <p>
                <strong>ICE Score:</strong> {alert.ice}/30
              </p>
            </div>
          ))}
        </section>
      )}

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
            <h2>Funnel Analysis</h2>
            <p>
              Link Clicks → Landing Page Views → Add To Cart → Checkout → Purchase
            </p>
          </div>
        </div>
        <section className="dash-kpi-grid">
          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>LPV Rate</span>
              <div>⚡</div>
            </div>
            <strong>{formatValue(totals.lpv_rate, "percent")}</strong>
          </div>
          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>ATC Rate</span>
              <div>🛒</div>
            </div>
            <strong>{formatValue(totals.atc_rate, "percent")}</strong>
          </div>
          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>Checkout Rate</span>
              <div>💳</div>
            </div>
            <strong>{formatValue(totals.checkout_rate, "percent")}</strong>
          </div>
          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>Purchase Rate</span>
              <div>✅</div>
            </div>
            <strong>{formatValue(totals.purchase_rate, "percent")}</strong>
          </div>
          <div className="dash-kpi-card">
            <div className="dash-kpi-top">
              <span>Cart Abandonment</span>
              <div>⚠️</div>
            </div>
            <strong>{formatValue(totals.cart_abandonment_rate, "percent")}</strong>
          </div>
        </section>
        <section className="dash-insights-grid">
          {funnelDiagnosis.map((item, index) => (
            <div className="dash-insight-card" key={index}>
              <h3>{item.stage}</h3>
              <p>
                <strong>Problem:</strong> {item.problem}
              </p>
              <p>
                <strong>Likely Cause:</strong> {item.cause}
              </p>
              <p>
                <strong>Recommended Action:</strong> {item.action}
              </p>
            </div>
          ))}
        </section>
      </section>

      {creativeSummary && (
        <section className="dash-table-card" style={{ marginBottom: 18 }}>
          <div className="dash-table-head">
            <div>
              <h2>Creative Intelligence</h2>
              <p>تحليل تلقائي لأداء الإعلانات — اضغط Ads من القائمة للتفاصيل الكاملة</p>
            </div>
            <a href="/ads" style={{
              background: "linear-gradient(135deg, var(--primary), #4f46e5)",
              color: "white", border: "none", padding: "10px 18px",
              borderRadius: "var(--radius-md)", fontWeight: 700, fontSize: 13,
              cursor: "pointer", textDecoration: "none"
            }}>View Ads Scoring →</a>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            {[
              { label: "Winners 🏆", count: creativeSummary.winners.length,  color: "#f59e0b" },
              { label: "Scale ↑",    count: creativeSummary.scalable.length, color: "#06d6a0" },
              { label: "Test 🧪",    count: creativeSummary.tests.length,    color: "#6366f1" },
              { label: "Kill ✕",     count: creativeSummary.kills.length,    color: "#f43f5e" },
            ].map(item => (
              <div key={item.label} style={{
                background: `${item.color}10`, border: `1px solid ${item.color}25`,
                borderRadius: "var(--radius-lg)", padding: "16px 18px"
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: item.color, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8 }}>
                  {item.label}
                </div>
                <strong style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 28, fontWeight: 700, color: item.color }}>
                  {item.count}
                </strong>
              </div>
            ))}
          </div>
        </section>
      )}

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
