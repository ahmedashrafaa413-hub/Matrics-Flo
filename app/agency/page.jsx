"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const fmt = {
  money:  (v) => `$${Number(v||0).toFixed(2)}`,
  number: (v) => Number(v||0).toLocaleString(),
  x:      (v) => `${Number(v||0).toFixed(2)}x`,
};

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background:"var(--card)", backdropFilter:"blur(16px)",
      border:`1px solid ${color}25`, borderRadius:"var(--radius-lg)",
      padding:"16px 18px", position:"relative", overflow:"hidden"
    }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:color, borderRadius:"20px 20px 0 0" }} />
      <div style={{ fontSize:10, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:8 }}>{label}</div>
      <strong style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, fontWeight:700, color }}>{value}</strong>
    </div>
  );
}

function RoleBadge({ role }) {
  const cfg =
    role==="admin"   ? { color:"#06d6a0", bg:"rgba(6,214,160,0.1)"   } :
    role==="manager" ? { color:"#6366f1", bg:"rgba(99,102,241,0.1)"  } :
    role==="client"  ? { color:"#f59e0b", bg:"rgba(245,158,11,0.1)"  } :
                       { color:"#7b88b8", bg:"rgba(123,136,184,0.1)" };
  return (
    <span style={{ padding:"2px 8px", borderRadius:999, fontSize:10, fontWeight:700, color:cfg.color, background:cfg.bg, border:`1px solid ${cfg.color}25` }}>
      {role}
    </span>
  );
}

export default function AgencyPage() {
  const [workspaces, setWorkspaces] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName,    setNewName]    = useState("");
  const [newClient,  setNewClient]  = useState("");
  const [creating,   setCreating]   = useState(false);
  const router = useRouter();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res  = await fetch("/api/workspaces");
      const data = await res.json();
      if (data.success) setWorkspaces(data.workspaces || []);
    } catch {}
    finally { setLoading(false); }
  }

  async function create() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res  = await fetch("/api/workspaces", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: newName.trim(), client_name: newClient.trim() || null })
      });
      const data = await res.json();
      if (data.success) {
        await load();
        setNewName(""); setNewClient(""); setShowCreate(false);
      }
    } catch {}
    finally { setCreating(false); }
  }

  async function switchTo(ws) {
    await fetch("/api/workspaces/switch", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ workspace_id: ws.id })
    });
    router.push("/meta");
    router.refresh();
  }

  const totalWorkspaces = workspaces.length;
  const adminCount      = workspaces.filter(w => w.role === "admin").length;

  return (
    <main style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
        <div>
          <span style={{
            display:"inline-flex", alignItems:"center", gap:6,
            fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.8px",
            color:"var(--primary)", background:"rgba(99,102,241,0.08)",
            border:"1px solid rgba(99,102,241,0.2)", padding:"5px 12px",
            borderRadius:999, marginBottom:12
          }}>
            🏢 Agency Mode
          </span>
          <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:28, fontWeight:700, color:"var(--text)", letterSpacing:"-0.5px", marginBottom:6 }}>
            Agency Overview
          </h1>
          <p style={{ fontSize:14, color:"var(--muted)" }}>كل عملاءك في مكان واحد — بدّل بينهم بضغطة</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            background:"linear-gradient(135deg,var(--primary),#4f46e5)", color:"#fff",
            border:"none", padding:"11px 20px", borderRadius:"var(--radius-md)",
            fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit",
            boxShadow:"0 0 20px rgba(99,102,241,0.25)"
          }}
        >
          + New Workspace
        </button>
      </div>

      {/* Summary */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
        <StatCard label="Total Workspaces" value={totalWorkspaces} color="#6366f1" />
        <StatCard label="As Admin"         value={adminCount}      color="#06d6a0" />
        <StatCard label="As Member"        value={totalWorkspaces - adminCount} color="#f59e0b" />
      </div>

      {/* Create modal */}
      {showCreate && (
        <div style={{
          background:"var(--card)", backdropFilter:"blur(16px)",
          border:"1px solid var(--border-2)", borderRadius:"var(--radius-xl)",
          padding:24
        }}>
          <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:700, color:"var(--text)", marginBottom:16 }}>
            New Workspace
          </h2>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
            <div>
              <label style={{ display:"block", fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:7 }}>
                Workspace Name *
              </label>
              <input
                autoFocus
                placeholder="e.g. Lord Oil Campaign"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"10px 14px", color:"var(--text)", fontSize:13, fontFamily:"inherit", outline:"none" }}
              />
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:7 }}>
                Client Name
              </label>
              <input
                placeholder="e.g. Lord Oil"
                value={newClient}
                onChange={e => setNewClient(e.target.value)}
                onKeyDown={e => e.key==="Enter" && create()}
                style={{ width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"10px 14px", color:"var(--text)", fontSize:13, fontFamily:"inherit", outline:"none" }}
              />
            </div>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button
              onClick={create}
              disabled={!newName.trim() || creating}
              style={{ background:"linear-gradient(135deg,var(--primary),#4f46e5)", color:"#fff", border:"none", padding:"10px 20px", borderRadius:"var(--radius-md)", fontWeight:700, fontSize:13, cursor:newName.trim()?"pointer":"not-allowed", fontFamily:"inherit" }}
            >
              {creating ? "Creating..." : "Create Workspace"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewName(""); setNewClient(""); }}
              style={{ background:"transparent", color:"var(--muted)", border:"1px solid var(--border)", padding:"10px 18px", borderRadius:"var(--radius-md)", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Workspaces grid */}
      {loading ? (
        <div className="dash-empty"><h3>⏳ Loading workspaces...</h3></div>
      ) : workspaces.length === 0 ? (
        <div className="dash-empty">
          <h3>No workspaces yet</h3>
          <p>Create your first workspace to get started.</p>
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 }}>
          {workspaces.map(ws => (
            <div
              key={ws.id}
              style={{
                background:"var(--card)", backdropFilter:"blur(16px)",
                border:`1px solid ${ws.is_active ? "rgba(99,102,241,0.35)" : "var(--border)"}`,
                borderRadius:"var(--radius-xl)", padding:20, display:"flex",
                flexDirection:"column", gap:14, transition:"all 0.2s"
              }}
            >
              {/* Workspace header */}
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{
                    width:38, height:38, borderRadius:10, flexShrink:0,
                    background: ws.is_active ? "linear-gradient(135deg,var(--primary),var(--accent))" : "var(--glass-2)",
                    border:"1px solid var(--border)", display:"flex", alignItems:"center",
                    justifyContent:"center", fontSize:13, fontWeight:700,
                    color: ws.is_active ? "#fff" : "var(--muted)"
                  }}>
                    {(ws.client_name || ws.name || "W").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:700, color:"var(--text)" }}>
                      {ws.client_name || ws.name}
                    </div>
                    <div style={{ fontSize:11, color:"var(--muted)", marginTop:1 }}>{ws.name}</div>
                  </div>
                </div>
                <RoleBadge role={ws.role} />
              </div>

              {/* Active indicator */}
              {ws.is_active && (
                <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:"var(--primary)" }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background:"var(--primary)" }} />
                  Active workspace
                </div>
              )}

              {/* Meta info */}
              <div style={{ fontSize:11, color:"var(--muted)", display:"flex", alignItems:"center", gap:6 }}>
                <span>Created {new Date(ws.created_at).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}</span>
              </div>

              {/* Actions */}
              <div style={{ display:"flex", gap:8, marginTop:"auto" }}>
                {!ws.is_active && (
                  <button
                    onClick={() => switchTo(ws)}
                    style={{
                      flex:1, background:"rgba(99,102,241,0.1)", color:"var(--primary)",
                      border:"1px solid rgba(99,102,241,0.25)", padding:"9px",
                      borderRadius:"var(--radius-md)", fontWeight:700, fontSize:12,
                      cursor:"pointer", fontFamily:"inherit"
                    }}
                  >
                    Switch to →
                  </button>
                )}
                {ws.is_active && (
                  <button
                    onClick={() => router.push("/meta")}
                    style={{
                      flex:1, background:"linear-gradient(135deg,var(--primary),#4f46e5)", color:"#fff",
                      border:"none", padding:"9px", borderRadius:"var(--radius-md)",
                      fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit"
                    }}
                  >
                    Open Dashboard →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
