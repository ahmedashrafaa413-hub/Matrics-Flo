"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function completeServerLogin(session) {
    const sessionResponse = await fetch("/api/auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        access_token: session?.access_token,
        refresh_token: session?.refresh_token,
        expires_in: session?.expires_in
      })
    });

    const sessionResult = await sessionResponse.json().catch(() => ({}));

    if (!sessionResponse.ok || !sessionResult.success) {
      throw new Error(sessionResult.error || "Failed to save server session.");
    }

    const workspaceResponse = await fetch("/api/workspace/ensure", {
      method: "POST"
    });

    const workspaceResult = await workspaceResponse.json().catch(() => ({}));

    if (!workspaceResponse.ok || !workspaceResult.success) {
      throw new Error(workspaceResult.error || "Failed to prepare workspace.");
    }
  }

  async function handleLogin(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      if (!email || !password) {
        setError("Please enter email and password.");
        setLoading(false);
        return;
      }

      const { data, error: loginError } =
        await supabase.auth.signInWithPassword({
          email,
          password
        });

      if (loginError) {
        setError(loginError.message);
        setLoading(false);
        return;
      }

      if (!data?.session?.access_token) {
        setError("Login succeeded but session token was not returned.");
        setLoading(false);
        return;
      }

      await completeServerLogin(data.session);

      setSuccess(true);
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err.message || "Unexpected login error.");
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;

      const { error: googleError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${siteUrl}/auth/callback?next=/dashboard`
        }
      });

      if (googleError) {
        setError(googleError.message);
        setLoading(false);
      }
    } catch (err) {
      setError(err.message || "Failed to start Google login.");
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(101, 87, 255, 0.25), transparent 35%), #070817",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "#ffffff"
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 460,
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 24,
          background: "rgba(14, 16, 35, 0.88)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
          padding: 32
        }}
      >
        <div style={{ marginBottom: 28, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
          {/* Icon mark */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 307.88 307.88" style={{ width: 52, height: 52, marginBottom: 10 }}>
            <rect x=".5" y=".5" width="306.88" height="306.88" rx="22" ry="22" fill="#6366f1" opacity="0.1"/>
            <rect x=".5" y=".5" width="306.88" height="306.88" rx="22" ry="22" fill="none" stroke="#6366f1" strokeWidth="1.5" opacity="0.35"/>
            <rect x="47.71" y="212.96" width="41.31" height="59.02" rx="5" ry="5" fill="#6366f1" opacity="0.25"/>
            <rect x="100.83" y="168.7" width="41.31" height="103.28" rx="5" ry="5" fill="#6366f1" opacity="0.55"/>
            <rect x="153.94" y="118.53" width="41.31" height="153.44" rx="5" ry="5" fill="#6366f1" opacity="0.82"/>
            <rect x="218.86" y="53.61" width="41.31" height="218.36" rx="5" ry="5" fill="#06d6a0"/>
          </svg>
          {/* Wordmark */}
          <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize: 28, fontWeight: 700, color: "#f0f3ff", letterSpacing: "-0.5px", lineHeight: 1 }}>
            Metrics<span style={{ color: "#06d6a0" }}>Flo</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#4a5278", letterSpacing: "0.22em", textTransform: "uppercase", marginTop: 6 }}>
            Ad Intelligence
          </div>

          <p
            style={{
              margin: "10px 0 0",
              color: "#9ca3af",
              fontSize: 14
            }}
          >
            Login to your marketing intelligence workspace
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{
            width: "100%",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 16,
            background: "rgba(255,255,255,0.06)",
            color: "#ffffff",
            padding: "14px 18px",
            fontSize: 15,
            fontWeight: 900,
            cursor: loading ? "not-allowed" : "pointer",
            marginBottom: 18
          }}
        >
          Continue with Google
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 18,
            color: "#6b7280",
            fontSize: 12,
            fontWeight: 800
          }}
        >
          <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
          OR
          <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
        </div>

        <form onSubmit={handleLogin} style={{ display: "grid", gap: 16 }}>
          <div>
            <label
              style={{
                display: "block",
                marginBottom: 8,
                color: "#c7d2fe",
                fontWeight: 700,
                fontSize: 13
              }}
            >
              Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              style={{
                width: "100%",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 14,
                background: "rgba(255,255,255,0.06)",
                color: "#ffffff",
                padding: "14px 16px",
                outline: "none",
                fontSize: 15
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                marginBottom: 8,
                color: "#c7d2fe",
                fontWeight: 700,
                fontSize: 13
              }}
            >
              Password
            </label>

            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              style={{
                width: "100%",
                border: "1px solid rgba(255,255,255,0.14)",
                borderRadius: 14,
                background: "rgba(255,255,255,0.06)",
                color: "#ffffff",
                padding: "14px 16px",
                outline: "none",
                fontSize: 15
              }}
            />
          </div>

          {error && (
            <div
              style={{
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

          {success && (
            <div
              style={{
                border: "1px solid rgba(34, 197, 94, 0.35)",
                background: "rgba(34, 197, 94, 0.1)",
                color: "#4ade80",
                borderRadius: 14,
                padding: "12px 14px",
                fontSize: 13,
                fontWeight: 700
              }}
            >
              Login successful. Redirecting...
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              border: "none",
              borderRadius: 16,
              background: loading
                ? "rgba(101, 87, 255, 0.45)"
                : "linear-gradient(135deg, #6557ff, #22d3ee)",
              color: "#ffffff",
              padding: "14px 18px",
              fontSize: 15,
              fontWeight: 900,
              cursor: loading ? "not-allowed" : "pointer",
              marginTop: 6
            }}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>

        <p
          style={{
            color: "#9ca3af",
            fontSize: 13,
            textAlign: "center",
            marginTop: 20
          }}
        >
          Do not have an account?{" "}
          <a
            href="/signup"
            style={{
              color: "#22d3ee",
              fontWeight: 800,
              textDecoration: "none"
            }}
          >
            Create account
          </a>
        </p>
      </section>
    </main>
  );
}
