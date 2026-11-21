"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Circle } from "lucide-react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting, removeSetting } from "../../lib/storage";

const COMING_SOON = [
  { name: "Google Ads",  iconBg: "#4285F4", desc: "Search, Performance Max, YouTube",  platform: "google-ads" },
  { name: "TikTok Ads",  iconBg: "#010101", desc: "Campaigns, ad groups, creatives",   platform: "tiktok"     },
  { name: "Shopify",     iconBg: "#96BF48", desc: "Revenue, orders, products",          platform: "shopify"    },
];

/* ── Platform SVG Icons ── */
const MetaIcon = () => (
  <svg viewBox="0 0 36 36" width="26" height="26" fill="none">
    <path d="M18 3C9.716 3 3 9.716 3 18c0 7.49 5.49 13.701 12.68 14.812V22.3h-3.812V18H15.68v-3.274c0-3.76 2.24-5.836 5.665-5.836 1.641 0 3.358.293 3.358.293v3.692h-1.891c-1.863 0-2.444 1.156-2.444 2.342V18h4.16l-.665 4.3H20.37v10.512C27.51 31.701 33 25.49 33 18c0-8.284-6.716-15-15-15z" fill="white"/>
  </svg>
);

const GA4Icon = () => (
  <svg viewBox="0 0 48 48" width="26" height="26" fill="none">
    <path d="M44 24c0 11.046-8.954 20-20 20S4 35.046 4 24 12.954 4 24 4s20 8.954 20 20z" fill="white" fillOpacity="0.15"/>
    <rect x="10" y="30" width="8" height="10" rx="2" fill="white"/>
    <rect x="20" y="22" width="8" height="18" rx="2" fill="white" fillOpacity="0.85"/>
    <rect x="30" y="14" width="8" height="26" rx="2" fill="white" fillOpacity="0.65"/>
  </svg>
);

const SnapchatIcon = () => (
  <svg viewBox="0 0 36 36" width="26" height="26" fill="none">
    <path d="M18.001 4c-3.308 0-7.14 2.077-7.14 7.56v1.52c-.48-.072-.912-.108-1.236-.108-.504 0-.816.168-.996.336-.288.264-.396.636-.288 1.02.228.828 1.44 1.464 2.472 1.776-.072.252-.168.516-.288.78-1.248 2.724-3.576 3.504-4.308 3.792-.432.168-.528.516-.516.78.012.252.096.552.456.78.9.564 2.436.816 3.084.9.144.516.3 1.56 1.428 1.56.588 0 1.284-.168 2.148-.372.684-.168 1.464-.36 2.364-.36.792 0 1.44.192 2.028.372.84.252 1.56.468 2.244.468 1.14 0 1.308-1.056 1.44-1.572.636-.084 2.172-.336 3.072-.9.36-.228.456-.516.456-.78.012-.264-.084-.612-.516-.78-.732-.288-3.06-1.068-4.308-3.792a7.14 7.14 0 0 1-.288-.78c1.032-.312 2.244-.948 2.472-1.776.108-.384 0-.756-.288-1.02-.18-.168-.492-.336-.996-.336-.324 0-.756.036-1.236.108v-1.52C25.141 6.077 21.309 4 18.001 4z" fill="#000"/>
  </svg>
);

const TikTokIcon = () => (
  <svg viewBox="0 0 36 36" width="26" height="26" fill="none">
    <path d="M25.5 8.1a7.2 7.2 0 0 1-1.74-4.68h-4.8v17.4c-.06 1.98-1.68 3.6-3.66 3.6a3.66 3.66 0 0 1-3.66-3.66 3.66 3.66 0 0 1 3.66-3.66c.36 0 .72.06 1.05.15V12.3c-.34-.05-.69-.09-1.05-.09a8.46 8.46 0 0 0-8.46 8.46 8.46 8.46 0 0 0 8.46 8.46 8.46 8.46 0 0 0 8.46-8.46V12c1.59 1.14 3.51 1.8 5.58 1.8V9c-1.4 0-2.73-.45-3.84-1.2l-.01.3z" fill="white"/>
    <path d="M25.5 8.1a7.2 7.2 0 0 1-1.74-4.68h-1.56s.72 3.3 3.3 4.68z" fill="#25F4EE"/>
    <path d="M15.3 24.84a3.66 3.66 0 0 1-3.66-3.66 3.66 3.66 0 0 1 3.66-3.66c.36 0 .72.06 1.05.15v-4.47c-.34-.05-.69-.09-1.05-.09a8.46 8.46 0 0 0-8.46 8.46 8.46 8.46 0 0 0 8.46 8.46 8.46 8.46 0 0 0 8.46-8.46l-.03-9c1.59 1.14 3.51 1.8 5.58 1.8v-4.8c-3.3-.09-5.94-2.4-6.42-5.46h-4.8v17.4c-.06 1.98-1.68 3.6-3.66 3.6l-.13-.03z" fill="#FE2C55"/>
    <path d="M29.34 13.8v-4.8c-3.3-.09-5.94-2.4-6.42-5.46h-1.5c.48 3.06 3.12 5.37 6.42 5.46v4.8c-2.07 0-3.99-.66-5.58-1.8l.03 9a8.46 8.46 0 0 1-8.49 8.43 8.46 8.46 0 0 1-7.11-3.9 8.46 8.46 0 0 0 7.11 3.9 8.46 8.46 0 0 0 8.49-8.43l-.03-9c1.56 1.14 3.51 1.8 5.58 1.8z" fill="#25F4EE"/>
  </svg>
);

const GoogleAdsIcon = () => (
  <svg viewBox="0 0 36 36" width="26" height="26" fill="none">
    <path d="M22.5 8L11 27h7l11.5-19H22.5z" fill="white"/>
    <circle cx="8" cy="27" r="4" fill="white" fillOpacity="0.7"/>
    <circle cx="28" cy="27" r="4" fill="white" fillOpacity="0.5"/>
  </svg>
);

const ShopifyIcon = () => (
  <svg viewBox="0 0 36 36" width="26" height="26" fill="none">
    <path d="M25.5 10.5c0-.15-.12-.27-.27-.27-.12 0-2.1-.15-2.1-.15s-1.38-1.38-1.53-1.5c-.15-.15-.42-.12-.54-.09l-.75.24C20.01 8.1 19.5 7.5 18.6 7.5c-.03 0-.06 0-.09.003C18.3 7.2 17.97 7.08 17.61 7.08c-2.73 0-4.05 3.42-4.47 5.16-.27.03-2.1.651-2.1.651-.6.183-.621.204-.699.771L8.76 25.5l13.44 2.52 7.26-1.572S25.5 10.65 25.5 10.5zm-6.21-.69c-.54.165-1.14.351-1.74.54.003-.075.006-.153.006-.234 0-.72-.099-1.302-.261-1.77.642.072 1.071.705 1.995 1.464z" fill="white"/>
  </svg>
);

function ConnectionsPageInner() {
  const searchParams = useSearchParams();

  const [accounts,        setAccounts]        = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [metaStatus,      setMetaStatus]      = useState("");
  const [metaLoading,     setMetaLoading]     = useState(false);
  const [metaConnected,   setMetaConnected]   = useState(false);

  const [gaStatus,        setGaStatus]        = useState("");
  const [gaConnected,     setGaConnected]     = useState(false);
  const [gaProperty,      setGaProperty]      = useState("");

  const [sallaConnected,  setSallaConnected]  = useState(false);
  const [snapConnected,   setSnapConnected]   = useState(false);
  const [snapAccount,     setSnapAccount]     = useState("");
  const [snapStatus,      setSnapStatus]      = useState("");

  useEffect(() => {
    // Show success/error from OAuth callback URL params
    const snapError   = searchParams.get("snapchat_error");
    const snapSuccess = searchParams.get("snapchat");
    if (snapError) {
      setSnapStatus("error:" + snapError);
    } else if (snapSuccess === "connected") {
      setSnapStatus("success:Connected successfully");
    }
    loadConnectionStatus();
  }, []);

  async function loadConnectionStatus() {
    setMetaLoading(true);
    try {
      const data = await apiGet("/api/connections/status");
      const providers = data.providers || {};
      const list = providers.meta?.accounts || [];
      setAccounts(list);
      const saved = getSetting("primary_meta_account", "");
      const savedExists = list.some((account) => account.id === saved);
      const def = (savedExists && saved) || list?.[0]?.id || "";
      setSelectedAccount(def);
      if (def) saveSetting("primary_meta_account", def);
      setMetaConnected(Boolean(providers.meta?.connected));
      setMetaStatus(
        providers.meta?.connected ? "Connected successfully" : "Not connected"
      );

      setGaConnected(Boolean(providers.ga4?.connected));
      setGaProperty(providers.ga4?.property_name || "");
      setGaStatus(
        providers.ga4?.connected ? "Connected successfully" : "Not connected"
      );

      setSallaConnected(Boolean(providers.salla?.connected));
      setSnapConnected(Boolean(providers.snapchat?.connected));
      setSnapAccount(providers.snapchat?.account_name || "");
    } catch (e) {
      setMetaConnected(false);
      setMetaStatus(e.message || "Not connected");
      setGaConnected(false);
      setGaStatus("Not connected");
      setSallaConnected(false);
      setSnapConnected(false);
      setSnapAccount("");
    } finally {
      setMetaLoading(false);
    }
  }

  function handleSelect(value) {
    setSelectedAccount(value);
    saveSetting("primary_meta_account", value);
    setMetaStatus("Primary account saved");
  }

  return (
    <div className="page-shell" dir="ltr">

      {/* ── Header ── */}
      <div style={{ marginBottom: 32 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 11, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.8px", color: "var(--accent)",
          background: "rgba(6,214,160,0.08)", border: "1px solid rgba(6,214,160,0.2)",
          padding: "5px 12px", borderRadius: 999, marginBottom: 12
        }}>
          <span style={{ width: 6, height: 6, background: "var(--accent)", borderRadius: "50%" }} />
          Integrations
        </span>
        <h1 style={{
          fontFamily: "'Space Grotesk', sans-serif", fontSize: 30,
          fontWeight: 700, letterSpacing: "-0.5px", color: "var(--text)", marginBottom: 8
        }}>
          Platform Connections
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Connect your marketing platforms and data sources to unlock full analytics.
        </p>
      </div>

      {/* ── Active Platforms ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 24 }}>

        {/* META */}
        <div className={`platform-card platform-meta${metaConnected ? " connected" : ""}`} style={{
          background: "var(--card)",
          border: metaConnected ? "1px solid rgba(24,119,242,0.25)" : "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", overflow: "hidden", position: "relative"
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 24px", borderBottom: metaConnected ? "1px solid var(--border)" : "none"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="platform-icon platform-meta" style={{
                width: 44, height: 44, borderRadius: 12, background: "rgba(24,119,242,0.12)",
                border: "1px solid rgba(24,119,242,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, boxShadow: "0 0 16px rgba(24,119,242,0.2)"
              }}><MetaIcon /></div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
                    Meta Ads
                  </h2>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    background: metaConnected ? "rgba(6,214,160,0.1)" : "rgba(244,63,94,0.1)",
                    border: metaConnected ? "1px solid rgba(6,214,160,0.25)" : "1px solid rgba(244,63,94,0.25)",
                    color: metaConnected ? "var(--accent)" : "var(--red)"
                  }}>
                    {metaConnected
                      ? <><CheckCircle2 size={10} style={{ verticalAlign:"middle" }} /> Connected</>
                      : <><Circle size={10} style={{ verticalAlign:"middle" }} /> Not Connected</>}
                  </span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
                  Facebook & Instagram — campaigns, ad sets, ads, insights
                </p>
              </div>
            </div>
            <a href="/api/meta/auth" style={{
              background: "linear-gradient(135deg, #1877F2, #0d5bb5)",
              color: "white", border: "none", padding: "10px 18px",
              borderRadius: "var(--radius-md)", fontWeight: 700, fontSize: 13,
              cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap",
              boxShadow: "0 0 16px rgba(24,119,242,0.25)"
            }}>
              {metaConnected ? "Reconnect" : "Connect Meta"}
            </a>
          </div>

          {metaConnected && (
            <div style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{
                    display: "block", fontSize: 11, fontWeight: 700,
                    color: "var(--muted)", textTransform: "uppercase",
                    letterSpacing: "1px", marginBottom: 8
                  }}>Primary Ad Account</label>
                  <select
                    value={selectedAccount}
                    onChange={(e) => handleSelect(e.target.value)}
                    style={{
                      width: "100%", background: "rgba(255,255,255,0.04)",
                      color: "var(--text)", border: "1px solid var(--border-2)",
                      borderRadius: "var(--radius-md)", padding: "11px 14px",
                      fontSize: 14, fontWeight: 500, fontFamily: "inherit",
                      outline: "none", cursor: "pointer"
                    }}
                  >
                    <option value="">Select account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} — {a.currency}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={loadConnectionStatus} disabled={metaLoading} style={{
                    background: "var(--glass-2)", color: "var(--text)",
                    border: "1px solid var(--border-2)", padding: "11px 16px",
                    borderRadius: "var(--radius-md)", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit"
                  }}>
                    <RefreshCw size={13} style={{ marginInlineEnd: 5, verticalAlign:"middle" }} />
                    {metaLoading ? "Loading..." : "Refresh"}
                  </button>
                  <button onClick={() => { removeSetting("primary_meta_account"); setSelectedAccount(""); }} style={{
                    background: "transparent", color: "var(--muted)",
                    border: "1px solid var(--border)", padding: "11px 16px",
                    borderRadius: "var(--radius-md)", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit"
                  }}>
                    Clear
                  </button>
                </div>
              </div>
              {metaStatus && (
                <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: metaConnected ? "var(--accent)" : "var(--red)", display:"flex", alignItems:"center", gap:5 }}>
                  {metaConnected ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {metaStatus}
                </p>
              )}
            </div>
          )}
        </div>

        {/* GA4 */}
        <div className={`platform-card platform-ga4${gaConnected ? " connected" : ""}`} style={{
          background: "var(--card)",
          border: gaConnected ? "1px solid rgba(249,171,0,0.25)" : "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", overflow: "hidden", position: "relative"
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 24px", borderBottom: gaConnected ? "1px solid var(--border)" : "none"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="platform-icon platform-ga4" style={{
                width: 44, height: 44, borderRadius: 12,
                background: "linear-gradient(135deg, rgba(249,171,0,0.15), rgba(227,116,0,0.15))",
                border: "1px solid rgba(249,171,0,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, boxShadow: "0 0 16px rgba(249,171,0,0.2)"
              }}><GA4Icon /></div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
                    Google Analytics 4
                  </h2>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    background: gaConnected ? "rgba(6,214,160,0.1)" : "rgba(244,63,94,0.1)",
                    border: gaConnected ? "1px solid rgba(6,214,160,0.25)" : "1px solid rgba(244,63,94,0.25)",
                    color: gaConnected ? "var(--accent)" : "var(--red)"
                  }}>
                    {gaConnected
                      ? <><CheckCircle2 size={10} style={{ verticalAlign:"middle" }} /> Connected</>
                      : <><Circle size={10} style={{ verticalAlign:"middle" }} /> Not Connected</>}
                  </span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
                  {gaConnected && gaProperty ? `Active: ${gaProperty}` : "Sessions, conversions, traffic sources, realtime"}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {gaConnected && (
                <a href="/ga" style={{
                  background: "var(--glass-2)", color: "var(--text)",
                  border: "1px solid var(--border-2)", padding: "10px 16px",
                  borderRadius: "var(--radius-md)", fontWeight: 600, fontSize: 13,
                  cursor: "pointer", textDecoration: "none"
                }}>
                  Open Dashboard
                </a>
              )}
              <a href="/api/ga/auth" style={{
                background: "linear-gradient(135deg, #E37400, #b85c00)",
                color: "white", border: "none", padding: "10px 18px",
                borderRadius: "var(--radius-md)", fontWeight: 700, fontSize: 13,
                cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap",
                boxShadow: "0 0 16px rgba(227,116,0,0.25)"
              }}>
                {gaConnected ? "Reconnect" : "Connect GA4"}
              </a>
            </div>
          </div>
          {gaConnected && (
            <div style={{ padding: "16px 24px", display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={loadConnectionStatus} disabled={metaLoading} style={{
                background: "var(--glass-2)", color: "var(--text)",
                border: "1px solid var(--border-2)", padding: "9px 16px",
                borderRadius: "var(--radius-md)", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
                display:"flex", alignItems:"center", gap:6
              }}>
                <RefreshCw size={13} /> Refresh Status
              </button>
              <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600, display:"flex", alignItems:"center", gap:5 }}>
                <CheckCircle2 size={13} /> {gaStatus}
              </span>
            </div>
          )}
        </div>

        {/* SALLA */}
        <div style={{
          background: "var(--card)", 
          border: sallaConnected ? "1px solid rgba(6,214,160,0.25)" : "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", overflow: "hidden"
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 24px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: "linear-gradient(135deg,#7C3AED,#5B21B6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, fontWeight: 900, color: "white", flexShrink: 0,
                boxShadow: "0 0 16px rgba(124,58,237,0.3)"
              }}>س</div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
                    Salla Store
                  </h2>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    background: sallaConnected ? "rgba(6,214,160,0.1)" : "rgba(99,102,241,0.1)",
                    border: sallaConnected ? "1px solid rgba(6,214,160,0.25)" : "1px solid rgba(99,102,241,0.25)",
                    color: sallaConnected ? "var(--accent)" : "#a5b4fc"
                  }}>
                    {sallaConnected
                      ? <><CheckCircle2 size={10} style={{ verticalAlign:"middle" }} /> Connected</>
                      : <><Circle size={10} style={{ verticalAlign:"middle" }} /> Ready to Connect</>}
                  </span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
                  Orders, revenue, customers — enables real ROAS calculation
                </p>
              </div>
            </div>
            <a href="/api/salla/auth" style={{
              background: "linear-gradient(135deg, #7C3AED, #5B21B6)",
              color: "white", border: "none", padding: "10px 18px",
              borderRadius: "var(--radius-md)", fontWeight: 700, fontSize: 13,
              cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap",
              boxShadow: "0 0 16px rgba(124,58,237,0.25)"
            }}>
              {sallaConnected ? "Reconnect" : "Connect Salla"}
            </a>
          </div>
        </div>
      </div>

      {/* ── Snapchat Ads ── */}
      <div style={{ marginBottom: 24 }}>
        <div className={`platform-card platform-snapchat${snapConnected ? " connected" : ""}`} style={{
          background: "var(--card)",
          border: snapConnected ? "1px solid rgba(255,252,0,0.3)" : "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", overflow: "hidden", position: "relative"
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 24px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="platform-icon platform-snapchat" style={{
                width: 44, height: 44, borderRadius: 12, background: "#FFFC00",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, boxShadow: "0 0 16px rgba(255,252,0,0.3)"
              }}><SnapchatIcon /></div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
                    Snapchat Ads
                  </h2>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    background: snapConnected ? "rgba(255,252,0,0.08)" : "rgba(99,102,241,0.1)",
                    border: snapConnected ? "1px solid rgba(255,252,0,0.3)" : "1px solid rgba(99,102,241,0.25)",
                    color: snapConnected ? "#E6E300" : "#a5b4fc"
                  }}>
                    {snapConnected
                      ? <><CheckCircle2 size={10} style={{ verticalAlign:"middle" }} /> Connected</>
                      : <><Circle size={10} style={{ verticalAlign:"middle" }} /> Ready to Connect</>}
                  </span>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
                  {snapConnected && snapAccount
                    ? `Active: ${snapAccount}`
                    : "Campaigns, ad squads, ads — hook rate, hold rate, completion"}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {snapConnected && (
                <a href="/snapchat" style={{
                  background: "var(--glass-2)", color: "var(--text)",
                  border: "1px solid var(--border-2)", padding: "10px 16px",
                  borderRadius: "var(--radius-md)", fontWeight: 600, fontSize: 13,
                  cursor: "pointer", textDecoration: "none"
                }}>
                  Open Dashboard
                </a>
              )}
              <a href="/api/snapchat/auth" style={{
                background: "linear-gradient(135deg, #E6E300, #b8b500)",
                color: "#000", border: "none", padding: "10px 18px",
                borderRadius: "var(--radius-md)", fontWeight: 700, fontSize: 13,
                cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap",
                boxShadow: "0 0 16px rgba(255,252,0,0.2)"
              }}>
                {snapConnected ? "Reconnect" : "Connect Snapchat"}
              </a>
            </div>
          </div>
        </div>

        {/* OAuth callback status */}
        {snapStatus && (
          <div style={{
            marginTop: 10, padding: "10px 16px", borderRadius: "var(--radius-md)",
            fontSize: 13, fontWeight: 500,
            background: snapStatus.startsWith("error:")
              ? "rgba(239,68,68,0.08)" : "rgba(6,214,160,0.08)",
            border: snapStatus.startsWith("error:")
              ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(6,214,160,0.3)",
            color: snapStatus.startsWith("error:") ? "#f87171" : "#06d6a0"
          }}>
            {snapStatus.startsWith("error:")
              ? <><AlertTriangle size={13} style={{ verticalAlign:"middle" }} /> {snapStatus.slice(6)}</>
              : <><CheckCircle2 size={13} style={{ verticalAlign:"middle" }} /> {snapStatus.slice(8)}</>}
          </div>
        )}
      </div>

      {/* ── Coming Soon ── */}
      <div>
        <p style={{
          fontSize: 11, fontWeight: 700, color: "var(--muted-2)",
          textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 14
        }}>Coming Soon</p>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))",
          gap: 12
        }}>
          {COMING_SOON.map((p) => (
            <div key={p.name} style={{
              background: "var(--card)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
              padding: "20px", display: "flex", flexDirection: "column",
              gap: 10, opacity: 0.6
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: p.iconBg,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {p.platform === "google-ads" && <GoogleAdsIcon />}
                {p.platform === "tiktok" && <TikTokIcon />}
                {p.platform === "shopify" && <ShopifyIcon />}
              </div>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{p.name}</h3>
                <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{p.desc}</p>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                background: "var(--glass-2)", border: "1px solid var(--border)",
                color: "var(--muted)", width: "fit-content"
              }}>Coming Soon</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense>
      <ConnectionsPageInner />
    </Suspense>
  );
}
