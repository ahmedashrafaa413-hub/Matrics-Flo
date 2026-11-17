"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "../../lib/supabaseClient";

export default function AccountMenu() {
  const [email, setEmail] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) => r.ok ? r.json() : null)
      .then((data) => { if (mounted) setEmail(data?.email || ""); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Could not clear server session.");
      const { error: authError } = await getSupabaseBrowserClient().auth.signOut({ scope: "local" });
      if (authError) throw authError;
      window.location.replace("/login");
    } catch {
      setError("Could not finish sign out. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div style={{ border:"1px solid var(--border)", borderRadius:14, padding:10, background:"rgba(255,255,255,0.035)" }}>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
        style={{ width:"100%", background:"transparent", border:0, color:"var(--text)", textAlign:"start", cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:9 }}>
        <span aria-hidden="true" style={{ fontSize:21 }}>◉</span>
        <span style={{ flex:1, minWidth:0 }}>
          <span style={{ display:"block", fontSize:13, fontWeight:800 }}>My Account</span>
          <span style={{ display:"block", fontSize:11, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{email || "Account settings"}</span>
        </span>
        <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
      </button>
      {expanded && (
        <div style={{ display:"grid", gap:8, paddingTop:12 }}>
          <Link href="/settings" style={{ color:"var(--text)", textDecoration:"none", fontSize:13 }}>⚙ Account settings</Link>
          <button type="button" disabled={busy} onClick={logout} style={{ color:"#ff9292", textAlign:"start", background:"transparent", border:0, padding:0, cursor:busy?"wait":"pointer", fontSize:13 }}>
            {busy ? "Signing out…" : "↪ Log out"}
          </button>
          {error && <p role="alert" style={{ color:"#ff9292", fontSize:11, margin:0 }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
