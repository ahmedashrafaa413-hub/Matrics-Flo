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
    <main style={{
      minHeight: "100vh",
      background: "#070817",
      display: "flex",
      color: "#ffffff",
      fontFamily: "'Inter', sans-serif",
    }}>

      {/* ── Left panel — brand ── */}
      <div style={{
        flex: "0 0 45%",
        background: "linear-gradient(160deg, rgba(99,102,241,0.18) 0%, rgba(6,214,160,0.06) 100%)",
        borderRight: "1px solid rgba(99,102,241,0.15)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "48px 52px",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Background glow */}
        <div style={{
          position: "absolute", top: -120, left: -120,
          width: 500, height: 500,
          background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }}/>
        <div style={{
          position: "absolute", bottom: -80, right: -80,
          width: 400, height: 400,
          background: "radial-gradient(circle, rgba(6,214,160,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }}/>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 307.88 307.88" style={{ width: 40, height: 40, flexShrink: 0 }}>
            <rect x=".5" y=".5" width="306.88" height="306.88" rx="22" ry="22" fill="#6366f1" opacity="0.15"/>
            <rect x=".5" y=".5" width="306.88" height="306.88" rx="22" ry="22" fill="none" stroke="#6366f1" strokeWidth="1.5" opacity="0.4"/>
            <rect x="47.71" y="212.96" width="41.31" height="59.02" rx="5" ry="5" fill="#6366f1" opacity="0.3"/>
            <rect x="100.83" y="168.7" width="41.31" height="103.28" rx="5" ry="5" fill="#6366f1" opacity="0.6"/>
            <rect x="153.94" y="118.53" width="41.31" height="153.44" rx="5" ry="5" fill="#6366f1" opacity="0.85"/>
            <rect x="218.86" y="53.61" width="41.31" height="218.36" rx="5" ry="5" fill="#06d6a0"/>
          </svg>
          <div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: "#f0f3ff", lineHeight: 1 }}>
              Metrics<span style={{ color: "#06d6a0" }}>Flo</span>
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#4a5278", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 4 }}>
              Ad Intelligence
            </div>
          </div>
        </div>

        {/* Center content */}
        <div style={{ position: "relative" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "rgba(6,214,160,0.1)", border: "1px solid rgba(6,214,160,0.2)",
            borderRadius: 999, padding: "5px 12px", marginBottom: 28,
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#06d6a0" }}/>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#06d6a0", letterSpacing: "0.05em" }}>AI-Powered Analytics</span>
          </div>
          <h1 style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontSize: 38, fontWeight: 700, lineHeight: 1.2,
            letterSpacing: "-0.8px", color: "#f0f3ff", marginBottom: 16,
          }}>
            Intelligence for<br/>
            <span style={{ color: "#6366f1" }}>Arab Advertisers</span>
          </h1>
          <p style={{ fontSize: 15, color: "#7b88b8", lineHeight: 1.7, maxWidth: 340 }}>
            Meta، Snapchat، سلة — كل بياناتك في مكان واحد مع تحليل ذكاء اصطناعي يساعدك تتخذ قرارات أسرع.
          </p>

          {/* Stats */}
          <div style={{ display: "flex", gap: 32, marginTop: 40 }}>
            {[
              { num: "9+", label: "منصات مدعومة" },
              { num: "AI", label: "تحليل تلقائي" },
              { num: "SAR", label: "عملة الريال" },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 24, fontWeight: 700, color: "#f0f3ff" }}>{s.num}</div>
                <div style={{ fontSize: 11, color: "#4a5278", fontWeight: 600, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom quote */}
        <div style={{
          borderLeft: "2px solid rgba(99,102,241,0.4)",
          paddingLeft: 16, position: "relative",
        }}>
          <p style={{ fontSize: 13, color: "#7b88b8", lineHeight: 1.6, fontStyle: "italic" }}>
            "أداة Analytics مصممة للسوق السعودي والعربي"
          </p>
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 40px",
      }}>
        <div style={{ width: "100%", maxWidth: 400 }}>

          <h2 style={{
            fontFamily: "'Space Grotesk',sans-serif",
            fontSize: 26, fontWeight: 700, color: "#f0f3ff",
            letterSpacing: "-0.4px", marginBottom: 8,
          }}>
            مرحباً بعودتك
          </h2>
          <p style={{ fontSize: 14, color: "#7b88b8", marginBottom: 32 }}>
            سجّل دخولك للوصول لداشبورد الأداء
          </p>

          {/* Google button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            style={{
              width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 14,
              background: "rgba(255,255,255,0.05)",
              color: "#ffffff",
              padding: "13px 18px",
              fontSize: 14, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              marginBottom: 20,
              transition: "background 0.15s",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }}/>
            <span style={{ fontSize: 12, color: "#4a5278", fontWeight: 600 }}>أو</span>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }}/>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#7b88b8", marginBottom: 7, letterSpacing: "0.02em" }}>
                البريد الإلكتروني
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  color: "#f0f3ff",
                  padding: "13px 16px",
                  fontSize: 14,
                  outline: "none",
                  transition: "border-color 0.15s",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#7b88b8", marginBottom: 7 }}>
                كلمة المرور
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  color: "#f0f3ff",
                  padding: "13px 16px",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>

            {error && (
              <div style={{
                background: "rgba(244,63,94,0.08)",
                border: "1px solid rgba(244,63,94,0.25)",
                borderRadius: 12, padding: "11px 14px",
                color: "#f43f5e", fontSize: 13, fontWeight: 600,
              }}>
                {error}
              </div>
            )}

            {success && (
              <div style={{
                background: "rgba(6,214,160,0.08)",
                border: "1px solid rgba(6,214,160,0.25)",
                borderRadius: 12, padding: "11px 14px",
                color: "#06d6a0", fontSize: 13, fontWeight: 600,
              }}>
                تم تسجيل الدخول، جاري التحويل...
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                background: loading ? "rgba(99,102,241,0.4)" : "linear-gradient(135deg, #6366f1, #4f46e5)",
                border: "none",
                borderRadius: 12,
                color: "#fff",
                padding: "14px",
                fontSize: 15, fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                marginTop: 4,
                boxShadow: loading ? "none" : "0 0 24px rgba(99,102,241,0.3)",
              }}
            >
              {loading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
            </button>
          </form>

          <p style={{ color: "#4a5278", fontSize: 13, textAlign: "center", marginTop: 24 }}>
            ليس لديك حساب؟{" "}
            <a href="/signup" style={{ color: "#6366f1", fontWeight: 700, textDecoration: "none" }}>
              إنشاء حساب
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
