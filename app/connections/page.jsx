"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting, removeSetting } from "../../lib/storage";

export default function ConnectionsPage() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [status, setStatus] = useState("Checking connection...");
  const [loading, setLoading] = useState(false);

  const [gaStatus, setGaStatus] = useState("Checking Google Analytics...");
  const [gaConnected, setGaConnected] = useState(false);
  const [gaProperty, setGaProperty] = useState("");

  async function loadAccounts() {
    setLoading(true);
    setStatus("Loading Meta accounts...");

    try {
      const data = await apiGet("/api/meta/accounts");
      const list = data.data || [];

      setAccounts(list);

      const saved = getSetting("primary_meta_account", "");
      const defaultId = saved || list?.[0]?.id || "";

      setSelectedAccount(defaultId);

      if (defaultId) {
        saveSetting("primary_meta_account", defaultId);
      }

      setStatus("Meta connected successfully");
    } catch (error) {
      setAccounts([]);
      setStatus(error.message || "Not connected to Meta");
    } finally {
      setLoading(false);
    }
  }

  async function checkGoogleAnalytics() {
    setGaStatus("Checking Google Analytics...");

    try {
      const data = await apiGet("/api/ga/overview");

      if (data?.success && data?.property_name) {
        setGaConnected(true);
        setGaProperty(data.property_name);
        setGaStatus("Google Analytics connected successfully");
      } else {
        setGaConnected(false);
        setGaStatus("Google Analytics is not connected");
      }
    } catch (error) {
      setGaConnected(false);
      setGaStatus(error.message || "Google Analytics is not connected");
    }
  }

  useEffect(() => {
    loadAccounts();
    checkGoogleAnalytics();
  }, []);

  function handleSelect(value) {
    setSelectedAccount(value);
    saveSetting("primary_meta_account", value);
    setStatus("Primary Meta account saved");
  }

  function disconnectLocal() {
    removeSetting("primary_meta_account");
    setSelectedAccount("");
    setAccounts([]);
    setStatus("Local Meta account selection removed");
  }

  return (
    <div className="page-shell">
      <div className="dashboard-header">
        <div>
          <span className="eyebrow">Connections</span>
          <h1>Platform Connections</h1>
          <p>Connect your marketing platforms and choose your main data sources.</p>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a className="primary-btn" href="/api/meta/auth">
            Connect Meta
          </a>

          <a className="primary-btn" href="/api/salla/auth">
            Connect Salla
          </a>

          <a className="primary-btn" href="/api/ga/auth">
            Connect GA4
          </a>
        </div>
      </div>

      <div className="chart-card">
        <h2>Meta Ads</h2>
        <p>Facebook, Instagram, campaigns, ad sets, ads and insights.</p>

        <div style={{ marginTop: 20 }}>
          <span className={accounts.length ? "badge connected" : "badge"}>
            {accounts.length ? "Connected" : "Not Connected"}
          </span>
        </div>

        <div className="form-row">
          <label>Primary Meta Ad Account</label>
          <select
            value={selectedAccount}
            onChange={(e) => handleSelect(e.target.value)}
            disabled={!accounts.length}
          >
            <option value="">
              {accounts.length ? "Select ad account" : "No accounts loaded"}
            </option>

            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} - {account.currency}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="primary-btn" onClick={loadAccounts} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Accounts"}
          </button>

          <button className="primary-btn" onClick={disconnectLocal}>
            Clear Local Selection
          </button>
        </div>

        <p className={accounts.length ? "dash-status" : "dash-error"}>{status}</p>
      </div>

      <div className="chart-card">
        <h2>Google Analytics 4</h2>
        <p>
          Connect GA4 to import sessions, users, page views, conversions, traffic
          sources, devices, countries, top pages and realtime active users.
        </p>

        <div style={{ marginTop: 20 }}>
          <span className={gaConnected ? "badge connected" : "badge"}>
            {gaConnected ? "Connected" : "Not Connected"}
          </span>
        </div>

        {gaProperty && (
          <p className="dash-status">
            Active Property: {gaProperty}
          </p>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
          <a className="primary-btn" href="/api/ga/auth">
            {gaConnected ? "Reconnect Google Analytics" : "Connect Google Analytics"}
          </a>

          <a className="primary-btn" href="/ga">
            Open GA4 Dashboard
          </a>

          <button className="primary-btn" onClick={checkGoogleAnalytics}>
            Refresh GA4 Status
          </button>
        </div>

        <p className={gaConnected ? "dash-status" : "dash-error"}>
          {gaStatus}
        </p>
      </div>

      <div className="chart-card">
        <h2>Salla Store</h2>
        <p>Connect Salla to import orders, revenue, customers and real sales data.</p>

        <div style={{ marginTop: 20 }}>
          <span className="badge">Ready to Connect</span>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
          <a className="primary-btn" href="/api/salla/auth">
            Connect Salla
          </a>
        </div>

        <p className="dash-status">
          After connection, MetricsFlo will use Salla revenue to calculate real ROAS.
        </p>
      </div>

      <div className="chart-card">
        <h2>Next Platforms</h2>
        <div className="platform-grid">
          {[
            ["Google Ads", "Search, Performance Max, YouTube and conversions"],
            ["TikTok Ads", "Campaigns, ad groups, ads and creatives"],
            ["Snapchat Ads", "Campaigns, ad squads and ads"],
            ["Shopify", "Revenue, orders, products and customers"]
          ].map(([name, desc]) => (
            <div className="platform-card" key={name}>
              <div className="platform-icon">{name[0]}</div>
              <h3>{name}</h3>
              <p>{desc}</p>
              <span className="badge">Coming Soon</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
