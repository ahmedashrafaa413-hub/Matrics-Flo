"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from "recharts";

const COLORS = ["#6557ff", "#22c55e", "#f59e0b", "#38bdf8", "#fb7185", "#a78bfa"];

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.step || "Failed to load data");
  }

  return data;
}

export default function GoogleAnalyticsDashboard() {
  const [overview, setOverview] = useState(null);
  const [timeseries, setTimeseries] = useState([]);
  const [channels, setChannels] = useState([]);
  const [devices, setDevices] = useState([]);
  const [countries, setCountries] = useState([]);
  const [pages, setPages] = useState([]);
  const [sources, setSources] = useState([]);
  const [realtime, setRealtime] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadAll() {
    try {
      setError("");

      const [
        overviewData,
        timeseriesData,
        channelsData,
        devicesData,
        countriesData,
        pagesData,
        sourcesData,
        realtimeData
      ] = await Promise.all([
        getJson("/api/ga/overview"),
        getJson("/api/ga/timeseries"),
        getJson("/api/ga/channels"),
        getJson("/api/ga/devices"),
        getJson("/api/ga/countries"),
        getJson("/api/ga/pages"),
        getJson("/api/ga/sources"),
        getJson("/api/ga/realtime")
      ]);

      setOverview(overviewData.metrics);
      setTimeseries(timeseriesData.rows || []);
      setChannels(channelsData.channels || []);
      setDevices(devicesData.devices || []);
      setCountries(countriesData.countries || []);
      setPages(pagesData.pages || []);
      setSources(sourcesData.sources || []);

      const activeUsers =
        realtimeData?.realtime?.rows?.[0]?.metricValues?.[0]?.value || 0;

      setRealtime(Number(activeUsers));
    } catch (err) {
      setError(err.message || "Failed to load GA4 dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();

    const interval = setInterval(() => {
      loadAll();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const deviceChart = useMemo(
    () =>
      devices.map((item) => ({
        name: item.device,
        value: item.sessions
      })),
    [devices]
  );

  const channelChart = useMemo(
    () =>
      channels.slice(0, 6).map((item) => ({
        name: item.channel,
        value: item.sessions
      })),
    [channels]
  );

  return (
    <main className="dash-pro ga-dashboard">
      <header className="dash-pro-header">
        <div>
          <span className="dash-badge">Google Analytics 4</span>
          <h1>GA4 Executive Overview</h1>
          <p>
            Live website analytics dashboard for sessions, users, conversions,
            traffic sources, devices, countries and top pages.
          </p>
        </div>

        <button className="dash-refresh" onClick={loadAll}>
          Refresh GA4
        </button>
      </header>

      {loading && <div className="ga-loading">Loading GA4 dashboard...</div>}
      {error && <div className="ga-error">{error}</div>}

      <section className="ga-kpi-grid">
        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Sessions</span>
          <strong className="ga-kpi-value">
            {formatNumber(overview?.sessions)}
          </strong>
          <span className="ga-kpi-sub">Last 30 days</span>
        </div>

        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Users</span>
          <strong className="ga-kpi-value">
            {formatNumber(overview?.users)}
          </strong>
          <span className="ga-kpi-sub">Total users</span>
        </div>

        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Page Views</span>
          <strong className="ga-kpi-value">
            {formatNumber(overview?.pageViews)}
          </strong>
          <span className="ga-kpi-sub">Screen page views</span>
        </div>

        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Conversions</span>
          <strong className="ga-kpi-value">
            {formatNumber(overview?.conversions)}
          </strong>
          <span className="ga-kpi-sub">Key events</span>
        </div>

        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Conversion Rate</span>
          <strong className="ga-kpi-value">
            {formatPercent(overview?.conversionRate)}
          </strong>
          <span className="ga-kpi-sub">Conversions / Sessions</span>
        </div>
      </section>

      <section className="ga-main-grid">
        <div className="ga-card">
          <div className="ga-card-header">
            <div>
              <h2>Traffic Performance Trend</h2>
              <p>Sessions, users and conversions over the last 30 days.</p>
            </div>
            <span className="ga-pill">Live API</span>
          </div>

          <div className="ga-chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27304f" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "#11162a",
                    border: "1px solid #27304f",
                    borderRadius: 14,
                    color: "#fff"
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="sessions"
                  stroke="#6557ff"
                  fill="#6557ff"
                  fillOpacity={0.18}
                  strokeWidth={3}
                />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke="#22c55e"
                  fill="#22c55e"
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="conversions"
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="ga-live-card">
          <span className="ga-live-status">
            <span className="ga-live-dot" />
            Realtime Active Users
          </span>
          <strong className="ga-live-number">{formatNumber(realtime)}</strong>
          <span className="ga-live-label">
            Auto-refreshing every 30 seconds
          </span>
        </div>
      </section>

      <section className="ga-mini-grid">
        <div className="ga-card">
          <div className="ga-card-header">
            <div>
              <h2>Traffic Channels</h2>
              <p>Top channel groups by sessions.</p>
            </div>
          </div>

          <div className="ga-chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={channelChart}
                  dataKey="value"
                  nameKey="name"
                  outerRadius={115}
                  label
                >
                  {channelChart.map((entry, index) => (
                    <Cell
                      key={entry.name}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#11162a",
                    border: "1px solid #27304f",
                    borderRadius: 14,
                    color: "#fff"
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="ga-card">
          <div className="ga-card-header">
            <div>
              <h2>Device Breakdown</h2>
              <p>Sessions by device category.</p>
            </div>
          </div>

          <div className="ga-chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deviceChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27304f" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "#11162a",
                    border: "1px solid #27304f",
                    borderRadius: 14,
                    color: "#fff"
                  }}
                />
                <Bar dataKey="value" fill="#22c55e" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="ga-mini-grid">
        <div className="ga-card">
          <div className="ga-card-header">
            <div>
              <h2>Top Countries</h2>
              <p>Countries driving the most sessions.</p>
            </div>
          </div>

          <div className="dash-table-scroll">
            <table className="ga-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Sessions</th>
                  <th>Users</th>
                  <th>Conversions</th>
                </tr>
              </thead>

              <tbody>
                {countries.map((item) => (
                  <tr key={item.country}>
                    <td className="ga-table-name">{item.country}</td>
                    <td>{formatNumber(item.sessions)}</td>
                    <td>{formatNumber(item.users)}</td>
                    <td>{formatNumber(item.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="ga-card">
          <div className="ga-card-header">
            <div>
              <h2>Top Pages</h2>
              <p>Most viewed pages over the last 30 days.</p>
            </div>
          </div>

          <div className="dash-table-scroll">
            <table className="ga-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Views</th>
                  <th>Sessions</th>
                </tr>
              </thead>

              <tbody>
                {pages.slice(0, 10).map((item) => (
                  <tr key={item.page}>
                    <td className="ga-table-name">{item.page}</td>
                    <td>{formatNumber(item.views)}</td>
                    <td>{formatNumber(item.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="ga-card">
        <div className="ga-card-header">
          <div>
            <h2>Top Traffic Sources</h2>
            <p>Source / Medium performance from GA4.</p>
          </div>
        </div>

        <div className="dash-table-scroll">
          <table className="ga-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Medium</th>
                <th>Sessions</th>
                <th>Users</th>
                <th>Conversions</th>
              </tr>
            </thead>

            <tbody>
              {sources.map((item, index) => (
                <tr key={`${item.source}-${item.medium}-${index}`}>
                  <td className="ga-table-name">{item.source}</td>
                  <td>{item.medium}</td>
                  <td>{formatNumber(item.sessions)}</td>
                  <td>{formatNumber(item.users)}</td>
                  <td>{formatNumber(item.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
