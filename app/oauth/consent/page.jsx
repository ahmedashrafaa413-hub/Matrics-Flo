"use client";
import { useEffect, useState } from "react";

export default function OAuthConsentPage() {
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const authorizationId =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("authorization_id");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        if (!authorizationId || authorizationId.length > 256) {
          throw new Error("Missing or invalid authorization request.");
        }

        // If we're on the bare domain (metricsflo.com), redirect to www where the session lives.
        // Cookies are httpOnly and scoped to www.metricsflo.com — they can't be read by JS
        // and don't cross to the bare domain. Redirecting to www solves this permanently.
        if (typeof window !== "undefined" && window.location.hostname === "metricsflo.com") {
          window.location.replace(
            "https://www.metricsflo.com/oauth/consent?authorization_id=" +
              encodeURIComponent(authorizationId)
          );
          return;
        }

        // Check login / owner via server-side route — cookies will be sent automatically
        // since we're now on www.metricsflo.com where the session cookies live.
        const check = await fetch("/api/oauth/owner-check", {
          cache: "no-store",
          credentials: "include"
        });

        if (check.status === 401) {
          // Always redirect to www for login so session cookies are set on www.
          // After login, the `next` param must also point at www so the full
          // consent flow completes on the same subdomain as the session.
          const consentUrl =
            "https://www.metricsflo.com/oauth/consent?authorization_id=" +
            encodeURIComponent(authorizationId);
          const loginUrl =
            "https://www.metricsflo.com/login?next=" +
            encodeURIComponent(consentUrl);
          window.location.replace(loginUrl);
          return;
        }

        if (check.status === 403) {
          throw new Error("This account is not authorized to connect AI clients.");
        }

        if (!check.ok) {
          throw new Error("Could not verify account authorization.");
        }

        // Fetch authorization details — cookies sent automatically
        const res = await fetch(
          "/api/oauth/authorize-details?authorization_id=" +
            encodeURIComponent(authorizationId),
          { cache: "no-store", credentials: "include" }
        );

        const payload = await res.json();

        if (!res.ok) {
          throw new Error(payload?.error || "Could not load authorization details.");
        }

        if (active) setDetails(payload.data);
      } catch (e) {
        if (active) setError(e?.message || "Could not load authorization details.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve) {
    if (submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/oauth/authorize-decide", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorization_id: authorizationId, approve })
      });

      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload?.error || "Authorization failed.");
      }

      if (!payload.redirect_url) {
        throw new Error("Authorization response did not include a redirect.");
      }

      window.location.assign(payload.redirect_url);
    } catch (e) {
      setError(e?.message || "Authorization failed.");
      setSubmitting(false);
    }
  }

  const client = (details?.client || details?.client_info) ?? {};
  const name = client.client_name || client.name || "External AI application";
  const redirect = client.redirect_uris?.[0] || details?.redirect_uri || "Not provided";
  const scopes = details?.scopes || details?.scope || [];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0f172a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        padding: "1rem"
      }}
    >
      <section
        style={{
          background: "#1e293b",
          border: "1px solid #334155",
          borderRadius: "12px",
          padding: "2rem",
          maxWidth: "480px",
          width: "100%",
          color: "#f1f5f9"
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: "1.4rem", fontWeight: 700 }}>
          Connect to MetricsFlo
        </h1>
        <p style={{ color: "#94a3b8", fontSize: "0.9rem" }}>
          Only the authorized MetricsFlo owner can grant read access to connected AI
          clients.
        </p>

        {loading && (
          <p style={{ color: "#94a3b8" }}>Loading authorization request…</p>
        )}

        {error && (
          <p role="alert" style={{ color: "#fca5a5", marginBottom: "1rem" }}>
            {error}
          </p>
        )}

        {details && !loading && (
          <>
            <div
              style={{
                background: "#0f172a",
                borderRadius: "8px",
                padding: "1rem",
                marginBottom: "1.5rem",
                fontSize: "0.9rem"
              }}
            >
              <div style={{ marginBottom: "0.5rem" }}>
                <span style={{ color: "#94a3b8" }}>Application: </span>
                <strong>{name}</strong>
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <span style={{ color: "#94a3b8" }}>Redirect URI: </span>
                <span style={{ wordBreak: "break-all", fontSize: "0.8rem" }}>
                  {redirect}
                </span>
              </div>
              {Array.isArray(scopes) && scopes.length > 0 && (
                <div>
                  <span style={{ color: "#94a3b8" }}>Requested scopes: </span>
                  <span>{scopes.join(", ")}</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={() => decide(false)}
                disabled={submitting}
                style={{
                  flex: 1,
                  padding: "0.65rem 1rem",
                  borderRadius: "8px",
                  border: "1px solid #475569",
                  background: "transparent",
                  color: "#cbd5e1",
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontSize: "0.9rem"
                }}
              >
                Deny
              </button>
              <button
                onClick={() => decide(true)}
                disabled={submitting}
                style={{
                  flex: 2,
                  padding: "0.65rem 1rem",
                  borderRadius: "8px",
                  border: "none",
                  background: submitting ? "#334155" : "#6366f1",
                  color: "#fff",
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontSize: "0.9rem",
                  fontWeight: 600
                }}
              >
                {submitting ? "Processing…" : "Approve connection"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
