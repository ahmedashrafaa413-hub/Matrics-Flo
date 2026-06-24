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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 947.19 307.88" style={{ width: 180, height: 58, margin: "0 auto 4px" }}>
          <defs>
            <style>{`
              .cb-c1{opacity:.1;fill:#6366f1;isolation:isolate}
              .cb-c2{opacity:.82;fill:#6366f1;isolation:isolate}
              .cb-c3{opacity:.55;fill:#6366f1;isolation:isolate}
              .cb-c4{opacity:.25;fill:#6366f1;isolation:isolate}
              .cb-c5{fill:#06d6a0}
              .cb-c6{fill:none;opacity:.3;stroke:#6366f1}
            `}</style>
          </defs>
          <rect className="cb-c1" x=".5" y=".5" width="306.88" height="306.88" rx="22" ry="22"/>
          <rect className="cb-c6" x=".5" y=".5" width="306.88" height="306.88" rx="22" ry="22"/>
          <rect className="cb-c4" x="47.71" y="212.96" width="41.31" height="59.02" rx="5" ry="5"/>
          <rect className="cb-c3" x="100.83" y="168.7" width="41.31" height="103.28" rx="5" ry="5"/>
          <rect className="cb-c2" x="153.94" y="118.53" width="41.31" height="153.44" rx="5" ry="5"/>
          <rect className="cb-c5" x="218.86" y="53.61" width="41.31" height="218.36" rx="5" ry="5"/>
          <text fontFamily="'Space Grotesk',Arial,sans-serif" fontSize="123.93" fontWeight="500" fill="#f0f3ff" transform="translate(348.82 148.04)"><tspan x="0" y="0">Metrics</tspan></text>
          <text fontFamily="'Space Grotesk',Arial,sans-serif" fontSize="123.93" fontWeight="500" fill="#06d6a0" transform="translate(775.02 148.04)"><tspan x="0" y="0">Flo</tspan></text>
          <text fontFamily="'Space Grotesk',Arial,sans-serif" fontSize="35.41" fill="#4a5278" letterSpacing=".42em" transform="translate(384.73 220.34)"><tspan x="0" y="0">AD INTELLIGENCE</tspan></text>
        </svg>

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
