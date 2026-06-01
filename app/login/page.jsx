"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  async function ensureWorkspace(session) {
    await fetch("/api/workspace/ensure", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`
      }
    });
  }

  async function handleLogin(e) {
    e.preventDefault();
    setStatus("Logging in...");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    if (data.session) {
      await ensureWorkspace(data.session);
    }

    window.location.href = "/dashboard";
  }

  return (
    <div className="page-shell">
      <div className="chart-card" style={{ maxWidth: 520, margin: "80px auto" }}>
        <h1>Login</h1>
        <p>Access your MetricsFlo dashboard.</p>

        <form onSubmit={handleLogin} style={{ display: "grid", gap: 16 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            required
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            required
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="primary-btn" type="submit">
            Login
          </button>
        </form>

        <p>{status}</p>
        <p>
          No account? <a href="/signup">Create one</a>
        </p>
      </div>
    </div>
  );
}
