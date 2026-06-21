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

      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in
        })
      });

      const sessionResult = await sessionResponse.json().catch(() => ({}));

      if (!sessionResponse.ok || !sessionResult.success) {
        setError(sessionResult.error || "Failed to save server session.");
        setLoading(false);
        return;
      }

      const workspaceResponse = await fetch("/api/workspace/ensure", {
        method: "POST"
      });

      const workspaceResult = await workspaceResponse.json().catch(() => ({}));

      if (!workspaceResponse.ok || !workspaceResult.success) {
        setError(workspaceResult.error || "Failed to create workspace.");
        setLoading(false);
        return;
      }

      setSuccess(true);

      window.location.href = "/dashboard";
    } catch (err) {
      setError(err.message || "Unexpected login error.");
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
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <h1
            style={{
              fontSize: 30,
              fontWeight: 900,
              margin: 0,
              letterSpacing: "-0.04em"
            }}
          >
            Metrics<span style={{ color: "#22d3ee" }}>Flo</span>
          </h1>

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
