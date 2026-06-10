"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function WorkspaceSwitcher() {
  const [workspaces,  setWorkspaces]  = useState([]);
  const [active,      setActive]      = useState(null);
  const [open,        setOpen]        = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);
  const [newName,     setNewName]     = useState("");
  const [newClient,   setNewClient]   = useState("");
  const [creating,    setCreating]    = useState(false);
  const [switching,   setSwitching]   = useState(false);
  const ref = useRef(null);
  const router = useRouter();

  useEffect(() => { load(); }, []);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function load() {
    try {
      const res  = await fetch("/api/workspaces");
      const data = await res.json();
      if (data.success) {
        setWorkspaces(data.workspaces || []);
        setActive(data.workspaces?.find(w => w.is_active) || data.workspaces?.[0] || null);
      }
    } catch {}
  }

  async function switchTo(ws) {
    if (ws.id === active?.id) { setOpen(false); return; }
    setSwitching(true);
    try {
      await fetch("/api/workspaces/switch", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ workspace_id: ws.id })
      });
      setActive(ws);
      setWorkspaces(prev => prev.map(w => ({ ...w, is_active: w.id === ws.id })));
      setOpen(false);
      router.refresh();
    } catch {}
    finally { setSwitching(false); }
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
        setActive(data.workspace);
        setNewName(""); setNewClient("");
        setShowCreate(false); setOpen(false);
        router.refresh();
      }
    } catch {}
    finally { setCreating(false); }
  }

  const roleColor = (role) =>
    role === "admin"   ? "#06d6a0" :
    role === "manager" ? "#6366f1" :
    role === "client"  ? "#f59e0b" : "#7b88b8";

  const initials = (name) =>
    (name || "W").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div ref={ref} style={{ padding: "0 12px 12px", position: "relative" }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", background: "var(--glass2)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)", padding: "9px 11px",
          display: "flex", alignItems: "center", gap: 9, cursor: "pointer",
          transition: "border-color 0.15s"
        }}
      >
        {/* Avatar */}
        <div style={{
          width: 26, height: 26, borderRadius: 7, background: "linear-gradient(135deg,var(--primary),var(--accent))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0
        }}>
          {active ? initials(active.client_name || active.name) : "?"}
        </div>
        <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {active?.client_name || active?.name || "Select workspace"}
          </div>
          {active?.role && (
            <div style={{ fontSize: 10, color: roleColor(active.role), fontWeight: 600, marginTop: 1 }}>
              {active.role}
            </div>
          )}
        </div>
        <span style={{ fontSize: 10, color: "var(--muted)", transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "none" }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% - 6px)", left: 12, right: 12, zIndex: 200,
          background: "var(--card-solid)", border: "1px solid var(--border-2)",
          borderRadius: "var(--radius-lg)", overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
        }}>
          {/* Workspace list */}
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {workspaces.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
                No workspaces yet
              </div>
            )}
            {workspaces.map(ws => (
              <button
                key={ws.id}
                onClick={() => switchTo(ws)}
                disabled={switching}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 9,
                  padding: "10px 14px", background: ws.is_active ? "rgba(99,102,241,0.1)" : "transparent",
                  border: "none", cursor: "pointer", transition: "background 0.12s", textAlign: "left"
                }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  background: ws.is_active ? "linear-gradient(135deg,var(--primary),var(--accent))" : "var(--glass2)",
                  border: "1px solid var(--border)", display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 10, fontWeight: 700,
                  color: ws.is_active ? "#fff" : "var(--muted)"
                }}>
                  {initials(ws.client_name || ws.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: ws.is_active ? "var(--text)" : "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ws.client_name || ws.name}
                  </div>
                  <div style={{ fontSize: 10, color: roleColor(ws.role), fontWeight: 600, marginTop: 1 }}>{ws.role}</div>
                </div>
                {ws.is_active && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>✓</span>}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "var(--border)" }} />

          {/* Agency overview */}
          <button
            onClick={() => { router.push("/agency"); setOpen(false); }}
            style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, textAlign: "left" }}
          >
            <span style={{ fontSize: 14 }}>🏢</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Agency Overview</span>
          </button>

          {/* Create new */}
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              style={{ width: "100%", padding: "10px 14px", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, textAlign: "left", borderTop: "1px solid var(--border)" }}
            >
              <span style={{ fontSize: 14, color: "var(--primary)" }}>+</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)" }}>New Workspace</span>
            </button>
          ) : (
            <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
              <input
                autoFocus
                placeholder="Workspace name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{ width: "100%", background: "var(--glass)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-md)", padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 6 }}
              />
              <input
                placeholder="Client name (optional)"
                value={newClient}
                onChange={e => setNewClient(e.target.value)}
                onKeyDown={e => e.key === "Enter" && create()}
                style={{ width: "100%", background: "var(--glass)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-md)", padding: "7px 10px", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={create}
                  disabled={!newName.trim() || creating}
                  style={{ flex: 1, background: "var(--primary)", color: "#fff", border: "none", borderRadius: "var(--radius-md)", padding: "7px", fontSize: 12, fontWeight: 700, cursor: newName.trim() ? "pointer" : "not-allowed", fontFamily: "inherit" }}
                >
                  {creating ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setNewName(""); setNewClient(""); }}
                  style={{ padding: "7px 10px", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--muted)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
