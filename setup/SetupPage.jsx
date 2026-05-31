"use client";

import { useEffect, useState } from "react";
import PlatformCard from "../components/PlatformCard";
import { apiGet } from "../lib/api";
import { getSetting, saveSetting } from "../lib/storage";

export default function SetupPage() {
  const [accounts, setAccounts] = useState([]);
  const [primaryAccount, setPrimaryAccount] = useState("");
  const [metaStatus, setMetaStatus] = useState("not_connected");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const saved = getSetting("primary_meta_account", "");
    setPrimaryAccount(saved);
    checkMetaConnection();
  }, []);

  async function checkMetaConnection() {
    try {
      const data = await apiGet("/api/meta/accounts");
      setAccounts(data.data || []);
      setMetaStatus("connected");

      if (!primaryAccount && data.data?.length) {
        setPrimaryAccount(data.data[0].id);
        saveSetting("primary_meta_account", data.data[0].id);
      }

      setStatus("Meta connected successfully");
    } catch {
      setMetaStatus("not_connected");
      setStatus("Meta is not connected");
    }
  }

  function connectMeta() {
    window.location.href = "/api/meta/auth";
  }

  function savePrimaryAccount(value) {
    setPrimaryAccount(value);
    saveSetting("primary_meta_account", value);
    setStatus("Primary Meta account saved");
  }

  return (
    <main className="setup-page">
      <header className="dash-header">
        <div>
          <h1>Setup</h1>
          <p>Connect your platforms and choose your main ad accounts.</p>
        </div>
      </header>

      <section className="panel setup-hero">
        <h2>Platform Connections</h2>
        <p>ابدأ بربط المنصات الإعلانية ومصادر البيانات.</p>

        <div className="platform-grid">
          <PlatformCard
            name="Meta Ads"
            description="Facebook, Instagram, campaigns, ad sets, ads and insights."
            icon="∞"
            status={metaStatus}
            onConnect={connectMeta}
            onManage={checkMetaConnection}
          />

          <PlatformCard
            name="Google Ads"
            description="Search, Performance Max, YouTube and conversions."
            icon="G"
            status="not_connected"
            onConnect={() => alert("Google Ads coming soon")}
          />

          <PlatformCard
            name="TikTok Ads"
            description="TikTok campaigns, ad groups, ads and creatives."
            icon="♪"
            status="not_connected"
            onConnect={() => alert("TikTok coming soon")}
          />

          <PlatformCard
            name="Snapchat Ads"
            description="Snapchat campaigns, ad squads and ads."
            icon="👻"
            status="not_connected"
            onConnect={() => alert("Snapchat coming soon")}
          />

          <PlatformCard
            name="GA4"
            description="Website events, traffic sources and conversions."
            icon="📈"
            status="not_connected"
            onConnect={() => alert("GA4 coming soon")}
          />

          <PlatformCard
            name="Shopify"
            description="Revenue, orders, products and customers."
            icon="🛒"
            status="not_connected"
            onConnect={() => alert("Shopify coming soon")}
          />
        </div>
      </section>

      <section className="panel">
        <h2>Account Mapping</h2>
        <p>اختر الحساب الأساسي الذي سيتم استخدامه في الداشبورد والتحليلات.</p>

        <div className="form-row">
          <label>Primary Meta Ad Account</label>

          <select
            value={primaryAccount}
            onChange={(e) => savePrimaryAccount(e.target.value)}
          >
            <option value="">Select Meta account</option>

            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} - {account.currency}
              </option>
            ))}
          </select>
        </div>

        <button onClick={checkMetaConnection}>Refresh Accounts</button>

        <p className="status">{status}</p>
      </section>
    </main>
  );
}
