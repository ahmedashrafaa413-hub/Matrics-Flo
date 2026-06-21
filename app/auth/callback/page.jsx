"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing login...");
  const [error, setError] = useState("");

  useEffect(() => {
    completeLogin();
  }, []);

  async function completeLogin() {
    try {
      setMessage("Reading Supabase session...");

      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      let session = data?.session;

      if (!session) {
        const { data: refreshedData, error: refreshError } =
          await supabase.auth.refreshSession();

        if (refreshError) {
          throw new Error(refreshError.message);
        }

        session = refreshedData?.session;
      }

      if (!session?.access_token) {
        throw new Error("No Supabase session found after Google login.");
      }

      setMessage("Saving server session...");

      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in
        })
      });

      const sessionResult = await sessionResponse.json().catch(() => ({}));

      if (!sessionResponse.ok || !sessionResult.success) {
        throw new Error(sessionResult.error || "Failed to save server session.");
      }

      setMessage("Preparing workspace...");

      const workspaceResponse = await fetch("/api/workspace/ensure", {
        method: "POST"
      });

      const workspaceResult = await workspaceResponse.json().catch(() => ({}));

      if (!workspaceResponse.ok || !workspaceResult.success) {
        throw new Error(workspaceResult.error || "Failed to ensure workspace.");
      }

      setMessage("Redirecting...");

      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || "/dashboard";

      window.location.href = next;
    } catch (err) {
      setError(err.message || "Google login callback failed.");
      setMessage("");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#070817",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 480,
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 24,
          background: "rgba(14,16,35,0.9)",
          padding: 32,
          textAlign: "center"
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>
          Metrics<span style={{ color: "#22d3ee" }}>Flo</span>
        </h1>

        {message && (
          <p style={{ marginTop: 16, color: "#c7d2fe", fontWeight: 700 }}>
            {message}
          </p>
        )}

        {error && (
          <div
            style={{
              marginTop: 18,
              border: "1px solid rgba(255, 71, 126, 0.35)",
              background: "rgba(255, 71, 126, 0.1)",
              color: "#fb7185",
              borderRadius: 14,
              padding: "12px 14px",
              fontSize: 13,
              fontWeight: 700
            }}
          >
            {error}
          </div>
        )}

        {error && (
          <a
            href="/login"
            style={{
              display: "inline-block",
              marginTop: 20,
              color: "#22d3ee",
              fontWeight: 900,
              textDecoration: "none"
            }}
          >
            Back to login
          </a>
        )}
      </section>
    </main>
  );
}
