"use client";

import { useEffect, useMemo, useState } from "react";
import DateRangePicker from "../../components/DateRangePicker";
import { useDateRange } from "../context/DateRangeContext";
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

function errorToText(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  return JSON.stringify(error);
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(
      data.step ||
        data.error?.message ||
        data.error ||
        `Failed to load ${url}`
    );
  }
  return data;
}

export default function GoogleAnalyticsDashboard() {
  const { dateRange } = useDateRange();

  const [properties, setProperties] = useState([]);
  const [selectedProperty, setSelectedProperty] = useState("");
  const [selectedPropertyName, setSelectedPropertyName] = useState("");

  const [overview, setOverview] = useState({
    sessions: 0,
    users: 0,
    pageViews: 0,
    conversions: 0,
    conversionRate: 0
  });

  const [timeseries, setTimeseries] = useState([]);
  const [channels, setChannels] = useState([]);
  const [devices, setDevices] = useState([]);
  const [countries, setCountries] = useState([]);
  const [pages, setPages] = useState([]);
  const [sources, setSources] = useState([]);
  const [realtime, setRealtime] = useState(0);

  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);

  async function loadProperties() {
    try {
      const data = await getJson("/api/ga/properties");
      setProperties(data.properties || []);
      setSelectedProperty(data.selected_property_id || "");
      setSelectedPropertyName(data.selected_property_name || "");
    } catch (error) {
      setErrors((prev) => [...prev, errorToText(error)]);
    }
  }

  async function changeProperty(propertyId) {
    try {
      const property = properties.find(
        (item) => String(item.id) === String(propertyId)
      );
      setSelectedProperty(propertyId);
      setSelectedPropertyName(property?.name || "");
      const response = await fetch("/api/ga/select-property", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          property_id: String(propertyId),
          property_name: property?.name || ""
        })
      });
      const text = await response.text();
      const result = text ? JSON.parse(text) : {};
      if (!response.ok || result.success === false) {
        throw new Error(
          result.error?.message ||
            result.error ||
            "Failed to update GA4 property"
        );
      }
      await loadAll(propertyId);
    } catch (error) {
      setErrors([error?.message || "Failed to switch GA4 property"]);
    }
  }

  async function loadAll(propertyIdOverride) {
    const propertyId = propertyIdOverride || selectedProperty;
    const params = `range=${dateRange}&propertyId=${propertyId}`;
    setLoading(true);
    setErrors([]);

    const requests = {
      overview: getJson(`/api/ga/overview?${params}`),
      timeseries: getJson(`/api/ga/timeseries?${params}`),
      channels: getJson(`/api/ga/channels?${params}`),
      devices: getJson(`/api/ga/devices?${params}`),
      countries: getJson(`/api/ga/countries?${params}`),
      pages: getJson(`/api/ga/pages?${params}`),
      sources: getJson(`/api/ga/sources?${params}`),
      realtime: getJson(`/api/ga/realtime?propertyId=${propertyId}`)
    };

    const results = await Promise.allSettled(
      Object.entries(requests).map(async ([key, promise]) => {
        const data = await promise;
        return { key, data };
      })
    );

    const nextErrors = [];

    results.forEach((result) => {
      if (result.status === "rejected") {
        nextErrors.push(errorToText(result.reason));
        return;
      }

      const { key, data } = result.value;

      if (key === "overview") {
        setOverview(data.metrics || {});
        setSelectedPropertyName(data.property_name || selectedPropertyName);
      }
      if (key === "timeseries") setTimeseries(data.rows || []);
      if (key === "channels") setChannels(data.channels || []);
      if (key === "devices") setDevices(data.devices || []);
      if (key === "countries") setCountries(data.countries || []);
      if (key === "pages") setPages(data.pages || []);
      if (key === "sources") setSources(data.sources || []);

      if (key === "realtime") {
        const activeUsers =
          data?.realtime?.rows?.[0]?.metricValues?.[0]?.value || 0;

        setRealtime(Number(activeUsers));
      }
    });

    setErrors(nextErrors);
    setLoading(false);
  }

  useEffect(() => {
    async function initDashboard() {
      await loadProperties();
      await loadAll();
    }
    initDashboard();

    const interval = setInterval(() => {
      loadAll();
    }, 30000);

    return () => clearInterval(interval);
  }, [dateRange]);

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
      <div className="ga-toolbar">
        <DateRangePicker />
        <div className="ga-property-switcher">
          <label>GA4 Property</label>
          <select
            value={selectedProperty}
            onChange={(e) => changeProperty(e.target.value)}
          >
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name} — {property.account_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <header className="dash-pro-header">
        <div>
          <span className="dash-badge">Google Analytics 4</span>
          <h1>GA4 Executive Overview</h1>
          <p>
            Current Property: <strong>{selectedPropertyName || "Loading..."}</strong>
          </p>
        </div>

        <button className="dash-refresh" onClick={loadAll}>
          {loading ? "Refreshing..." : "Refresh GA4"}
        </button>
      </header>

      {errors.length > 0 && (
        <div className="ga-error">
          {errors.map((item, index) => (
            <div key={index}>{item}</div>
          ))}
        </div>
      )}

      <section className="ga-kpi-grid">
        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Sessions</span>
          <strong className="ga-kpi-value">
            {formatNumber(overview.sessions)}
          </strong>
          <span className="ga-kpi-sub">Selected Date Range</span>
        </div>

        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Users</span>
          <strong className="ga-kpi-value">
            {formatNumber(overview.users)}
          </strong>
          <span className="ga-kpi-sub">Total users</span>
        </div>

        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Page Views</span>
          <strong className="ga-kpi-value">
            {formatNumber(overview.pageViews)}
          </strong>
          <span className="ga-kpi-sub">Screen page views</span>
        </div>

        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Conversions</span>
          <strong className="ga-kpi-value">
            {formatNumber(overview.conversions)}
          </strong>
          <span className="ga-kpi-sub">Key events</span>
        </div>

        <div className="ga-kpi-card">
          <span className="ga-kpi-label">Conversion Rate</span>
          <strong className="ga-kpi-value">
            {formatPercent(overview.conversionRate)}
          </strong>
          <span className="ga-kpi-sub">Conversions / Sessions</span>
        </div>
      </section>

      <section className="ga-main-grid">
        <div className="ga-card">
          <div className="ga-card-header">
            <div>
              <h2>Traffic Performance Trend</h2>
              <p>Sessions, users and conversions for the selected date range.</p>
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
              <p>Most viewed pages by selected date range.</p>
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
