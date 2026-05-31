"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting, removeSetting } from "../../lib/storage";

export default function ConnectionsPage() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [status, setStatus] = useState("Checking connection...");
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    loadAccounts();
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
          <p>Connect your marketing platforms and choose your main ad account.</p>
        </div>

        <a className="primary-btn" href="/api/meta/auth">
          Connect Meta
        </a>
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
        <h2>Next Platforms</h2>
        <div className="platform-grid">
          {[
            ["Google Ads", "Search, Performance Max, YouTube and conversions"],
            ["TikTok Ads", "Campaigns, ad groups, ads and creatives"],
            ["Snapchat Ads", "Campaigns, ad squads and ads"],
            ["GA4", "Website events, traffic sources and conversions"],
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
