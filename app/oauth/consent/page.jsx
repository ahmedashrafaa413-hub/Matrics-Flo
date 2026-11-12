"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../../../lib/supabaseClient";

export default function OAuthConsentPage() {
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const authorizationId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("authorization_id");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!authorizationId || authorizationId.length > 256) throw new Error("Missing or invalid authorization request.");
        const supabase = getSupabaseBrowserClient();
        const { data: session } = await supabase.auth.getSession();
        const accessToken = session?.session?.access_token;
        const check = await fetch("/api/oauth/owner-check", {
          cache: "no-store", credentials: "same-origin",
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
        });
        if (check.status === 401) {
          window.location.assign("/login?next=" + encodeURIComponent("/oauth/consent?authorization_id=" + encodeURIComponent(authorizationId)));
          return;
        }
        if (!check.ok) throw new Error("This account is not authorized to connect AI clients.");
        if (!accessToken) throw new Error("Sign in to MetricsFlo before approving this connection.");
        if (!supabase.auth.oauth?.getAuthorizationDetails) throw new Error("OAuth authorization is not available in the installed Supabase SDK.");
        const { data, error: authError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (authError) throw authError;
        if (active) setDetails(data);
      } catch (e) {
        if (active) setError(e?.message || "Could not load authorization details.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve) {
    if (!details || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: authError } = approve
        ? await supabase.auth.oauth.approveAuthorization(authorizationId)
        : await supabase.auth.oauth.denyAuthorization(authorizationId);
      if (authError) throw authError;
      if (!data?.redirect_url) throw new Error("Authorization response did not include a redirect.");
      // The redirect is issued by Supabase Auth after validating the registered OAuth client.
      window.location.assign(data.redirect_url);
    } catch (e) {
      setError(e?.message || "Authorization failed.");
      setSubmitting(false);
    }
  }

  const client = details?.client || details?.client_info || {};
  const name = client.client_name || client.name || "External AI application";
  const redirect = client.redirect_uris?.[0] || details?.redirect_uri || "Not provided";
  const scopes = details?.scopes || details?.scope || [];
  return <main style={{ minHeight: "100vh", background: "#080b17", color: "#f8fafc", padding: "8vh 20px", fontFamily: "Arial, sans-serif", direction: "ltr" }}>
    <section style={{ maxWidth: 560, margin: "auto", padding: 32, borderRadius: 18, border: "1px solid #334155", background: "#111827" }}>
      <h1 style={{ fontSize: 27, marginBottom: 8 }}>Connect to MetricsFlo</h1>
      <p style={{ color: "#cbd5e1" }}>Only the authorized MetricsFlo owner can grant read access to connected AI clients.</p>
      {loading ? <p>Loading authorization request…</p> : null}
      {error ? <p role="alert" style={{ color: "#fca5a5" }}>{error}</p> : null}
      {details ? <>
        <div style={{ padding: 18, background: "#1e293b", borderRadius: 12, margin: "20px 0", overflowWrap: "anywhere" }}>
          <p><strong>Requesting app:</strong> {name}</p>
          <p><strong>Redirect:</strong> {redirect}</p>
          <p><strong>Requested scopes:</strong> {Array.isArray(scopes) ? scopes.join(", ") || "Not specified" : String(scopes)}</p>
          <p><strong>Access:</strong> Read-only MetricsFlo MCP tools. No campaign edits.</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button disabled={submitting} onClick={() => decide(false)} style={{ padding: "12px 20px", cursor: "pointer" }}>Deny</button>
          <button disabled={submitting} onClick={() => decide(true)} style={{ padding: "12px 20px", background: "#4f46e5", color: "white", border: 0, borderRadius: 8, cursor: "pointer" }}>Approve connection</button>
        </div>
      </> : null}
    </section>
  </main>;
}
