"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabaseClient";

export default function SignupPage() {
  const [form, setForm] = useState({ name: "", company: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSignup(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: signupError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: {
            full_name: form.name.trim(),
            company_name: form.company.trim()
          }
        }
      });

      if (signupError) throw signupError;

      if (!data?.session) {
        setMessage("Check your email to confirm your account, then sign in.");
        return;
      }

      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.session)
      });

      if (!sessionResponse.ok) {
        const result = await sessionResponse.json().catch(() => ({}));
        throw new Error(result.error || "Failed to create the server session.");
      }

      const workspaceResponse = await fetch("/api/workspace/ensure", { method: "POST" });
      if (!workspaceResponse.ok) {
        const result = await workspaceResponse.json().catch(() => ({}));
        throw new Error(result.error || "Failed to create your workspace.");
      }

      window.location.href = "/dashboard";
    } catch (signupError) {
      setError(signupError.message || "Failed to create account.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.05)",
    color: "#fff"
  };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#070817", color: "#fff", padding: 24 }}>
      <form onSubmit={handleSignup} style={{ width: "100%", maxWidth: 430, padding: 32, border: "1px solid rgba(255,255,255,.12)", borderRadius: 20, background: "#0e1023" }}>
        <h1 style={{ marginTop: 0 }}>Create your MetricsFlo account</h1>
        <p style={{ color: "#8b95bd" }}>Your first workspace will be prepared automatically.</p>
        <div style={{ display: "grid", gap: 14 }}>
          <input aria-label="Full name" required value={form.name} onChange={update("name")} placeholder="Full name" style={inputStyle} />
          <input aria-label="Company name" value={form.company} onChange={update("company")} placeholder="Company name" style={inputStyle} />
          <input aria-label="Email" required type="email" autoComplete="email" value={form.email} onChange={update("email")} placeholder="Email" style={inputStyle} />
          <input aria-label="Password" required minLength={8} type="password" autoComplete="new-password" value={form.password} onChange={update("password")} placeholder="Password (8+ characters)" style={inputStyle} />
          {error && <p role="alert" style={{ color: "#fb7185", margin: 0 }}>{error}</p>}
          {message && <p style={{ color: "#06d6a0", margin: 0 }}>{message}</p>}
          <button disabled={loading} style={{ padding: 13, border: 0, borderRadius: 10, background: "#6366f1", color: "#fff", fontWeight: 700 }}>
            {loading ? "Creating account..." : "Create account"}
          </button>
          <a href="/login" style={{ color: "#a5b4fc", textAlign: "center" }}>Already have an account? Sign in</a>
        </div>
      </form>
    </main>
  );
}
