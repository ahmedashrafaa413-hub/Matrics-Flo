"use client";

import { useEffect, useState } from "react";
import PlatformLogo from "../../components/PlatformLogo";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting, removeSetting } from "../../lib/storage";

const COMING_SOON = [
  { name: "Google Ads", platform: "google-ads", desc: "Search, Performance Max, YouTube" },
  { name: "TikTok Ads", platform: "tiktok", desc: "Campaigns, ad groups, creatives"  },
  { name: "Shopify", platform: "shopify", desc: "Revenue, orders, products" },
];

export default function ConnectionsPage() {
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

  useEffect(() => {
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
        <div style={{
          background: "var(--card)", backdropFilter: "blur(16px)",
          border: metaConnected ? "1px solid rgba(6,214,160,0.25)" : "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", overflow: "hidden"
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 24px", borderBottom: metaConnected ? "1px solid var(--border)" : "none"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="connection-platform-logo" style={{
                width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.96)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, padding: 7,
                boxShadow: "0 0 16px rgba(24,119,242,0.3)"
              }}><PlatformLogo platform="meta" size={30} decorative /></div>
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
                    {metaConnected ? "● Connected" : "○ Not Connected"}
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
                    {metaLoading ? "Loading..." : "↺ Refresh"}
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
                <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: metaConnected ? "var(--accent)" : "var(--red)" }}>
                  {metaConnected ? "✓" : "✗"} {metaStatus}
                </p>
              )}
            </div>
          )}
        </div>

        {/* GA4 */}
        <div style={{
          background: "var(--card)", backdropFilter: "blur(16px)",
          border: gaConnected ? "1px solid rgba(6,214,160,0.25)" : "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", overflow: "hidden"
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 24px", borderBottom: gaConnected ? "1px solid var(--border)" : "none"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="connection-platform-logo" style={{
                width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.96)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, padding: 7,
                boxShadow: "0 0 16px rgba(227,116,0,0.3)"
              }}><PlatformLogo platform="ga4" size={30} decorative /></div>
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
                    {gaConnected ? "● Connected" : "○ Not Connected"}
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
                cursor: "pointer", fontFamily: "inherit"
              }}>↺ Refresh Status</button>
              <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
                ✓ {gaStatus}
              </span>
            </div>
          )}
        </div>

        {/* SALLA */}
        <div style={{
          background: "var(--card)", backdropFilter: "blur(16px)",
          border: sallaConnected ? "1px solid rgba(6,214,160,0.25)" : "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", overflow: "hidden"
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 24px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="connection-platform-logo" style={{
                width: 44, height: 44, borderRadius: 12,
                background: "#103f38",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, padding: 6,
                boxShadow: "0 0 16px rgba(124,58,237,0.3)"
              }}><PlatformLogo platform="salla" size={32} decorative /></div>
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
                    {sallaConnected ? "● Connected" : "○ Ready to Connect"}
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
        <div style={{
          background: "var(--card)", backdropFilter: "blur(16px)",
          border: snapConnected ? "1px solid rgba(255,252,0,0.25)" : "1px solid var(--border)",
          borderRadius: "var(--radius-xl)", overflow: "hidden"
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "22px 24px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div className="connection-platform-logo" style={{
                width: 44, height: 44, borderRadius: 12, background: "#FFFC00",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, overflow: "hidden",
                boxShadow: "0 0 16px rgba(255,252,0,0.25)"
              }}><PlatformLogo platform="snapchat" size={44} decorative /></div>
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
                    {snapConnected ? "● Connected" : "○ Ready to Connect"}
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
              background: "var(--card)", backdropFilter: "blur(12px)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
              padding: "20px", display: "flex", flexDirection: "column",
              gap: 10, opacity: 0.6
            }}>
              <div className="connection-platform-logo" style={{
                width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,0.96)",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 6
              }}><PlatformLogo platform={p.platform} size={28} decorative /></div>
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
