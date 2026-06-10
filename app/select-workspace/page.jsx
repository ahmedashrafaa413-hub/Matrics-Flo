"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SelectWorkspacePage() {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [switching,  setSwitching]  = useState(null);
  const router = useRouter();

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res  = await fetch("/api/workspaces");
      const data = await res.json();
      if (data.success) {
        const list = data.workspaces || [];
        setWorkspaces(list);
        // إذا في active workspace، روح عليه مباشرة
        if (data.active_workspace_id && list.length > 0) {
          router.replace("/meta");
        }
      }
    } catch {}
    finally { setLoading(false); }
  }

  async function select(ws) {
    setSwitching(ws.id);
    try {
      await fetch("/api/workspaces/switch", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ workspace_id: ws.id })
      });
      router.replace("/meta");
    } catch { setSwitching(null); }
  }

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ fontSize:14, color:"var(--muted)" }}>⏳ Loading...</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ width:"100%", maxWidth:480 }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{
            width:48, height:48, borderRadius:14, background:"linear-gradient(135deg,var(--primary),var(--accent))",
            display:"inline-flex", alignItems:"center", justifyContent:"center",
            fontSize:22, fontWeight:700, color:"#fff", marginBottom:14,
            boxShadow:"0 0 24px rgba(99,102,241,0.3)"
          }}>M</div>
          <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:24, fontWeight:700, color:"var(--text)", marginBottom:8 }}>
            Select Workspace
          </h1>
          <p style={{ fontSize:14, color:"var(--muted)" }}>Choose the client workspace to open</p>
        </div>

        {workspaces.length === 0 ? (
          <div style={{
            background:"var(--card)", border:"1px solid var(--border)",
            borderRadius:"var(--radius-xl)", padding:32, textAlign:"center"
          }}>
            <div style={{ fontSize:32, marginBottom:12 }}>🏢</div>
            <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:700, color:"var(--text)", marginBottom:8 }}>
              No workspaces yet
            </h2>
            <p style={{ fontSize:13, color:"var(--muted)", marginBottom:20 }}>
              Create your first workspace to get started
            </p>
            <button
              onClick={() => router.push("/agency")}
              style={{
                background:"linear-gradient(135deg,var(--primary),#4f46e5)", color:"#fff",
                border:"none", padding:"11px 24px", borderRadius:"var(--radius-md)",
                fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit"
              }}
            >
              Create Workspace →
            </button>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {workspaces.map(ws => (
              <button
                key={ws.id}
                onClick={() => select(ws)}
                disabled={!!switching}
                style={{
                  width:"100%", background:"var(--card)", backdropFilter:"blur(16px)",
                  border:"1px solid var(--border)", borderRadius:"var(--radius-xl)",
                  padding:"16px 20px", display:"flex", alignItems:"center", gap:14,
                  cursor:"pointer", transition:"all 0.15s", textAlign:"left",
                  opacity: switching && switching !== ws.id ? 0.5 : 1
                }}
              >
                <div style={{
                  width:42, height:42, borderRadius:12, flexShrink:0,
                  background:"linear-gradient(135deg,var(--primary),var(--accent))",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:14, fontWeight:700, color:"#fff"
                }}>
                  {(ws.client_name || ws.name || "W").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:700, color:"var(--text)" }}>
                    {ws.client_name || ws.name}
                  </div>
                  <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>
                    {ws.name} · {ws.role}
                  </div>
                </div>
                <span style={{ fontSize:14, color:"var(--muted)" }}>
                  {switching === ws.id ? "⏳" : "→"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
