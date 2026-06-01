"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  async function handleSignup(e) {
    e.preventDefault();
    setStatus("Creating account...");

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`
      }
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    setStatus("Account created. Please check your email to confirm.");
  }

  return (
    <div className="page-shell">
      <div className="chart-card" style={{ maxWidth: 520, margin: "80px auto" }}>
        <h1>Create Account</h1>
        <p>Create your MetricsFlo workspace.</p>

        <form onSubmit={handleSignup} style={{ display: "grid", gap: 16 }}>
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
            minLength={6}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="primary-btn" type="submit">
            Sign Up
          </button>
        </form>

        <p>{status}</p>
        <p>
          Already have an account? <a href="/login">Login</a>
        </p>
      </div>
    </div>
  );
}
