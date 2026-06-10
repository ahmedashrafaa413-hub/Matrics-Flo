"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import WorkspaceSwitcher from "../WorkspaceSwitcher";

const NAV = [
  {
    section: "Channels",
    items: [
      { href:"/meta",        label:"Meta Ads",         icon:"f", color:"#1877F2" },
      { href:"/ga",          label:"Google Analytics", icon:"G", color:"#E37400" },
      { href:"/salla",       label:"Salla",            icon:"س", color:"#7C3AED" },
      { href:"/snapchat",    label:"Snapchat Ads",     icon:"👻", color:"#FFFC00" },
      { href:"/shopify",     label:"Shopify",          icon:"S", color:"#96BF48", soon:true },
    ]
  },
  {
    section: "Account",
    items: [
      { href:"/agency",      label:"Agency Overview",  icon:"🏢" },
      { href:"/connections", label:"Connections",      icon:"⟐" },
      { href:"/settings",    label:"Settings",         icon:"⚙" },
    ]
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">M</div>
          <div className="sidebar-brand">
            <span className="sidebar-brand-name">Metrics <em>Flo</em></span>
            <span className="sidebar-brand-sub">Ad Intelligence</span>
          </div>
        </div>
      </div>

      {/* Workspace Switcher */}
      <WorkspaceSwitcher />

      <nav className="sidebar-nav" style={{ paddingTop: 0 }}>
        {NAV.map(group => (
          <div key={group.section}>
            <div className="nav-section-label">{group.section}</div>
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${pathname.startsWith(item.href) ? "active" : ""}`}
                style={item.soon ? { opacity:0.45, pointerEvents:"none" } : {}}
              >
                <span style={{
                  width:22, height:22, borderRadius:6, flexShrink:0,
                  background: item.color ? `${item.color}18` : "var(--glass-2)",
                  border: `1px solid ${item.color ? item.color+"30" : "var(--border)"}`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize: item.icon?.length > 1 ? 11 : 12, fontWeight:700,
                  color: item.color || "var(--muted)",
                  fontFamily: ["G","f","S"].includes(item.icon) ? "Arial,sans-serif" : "inherit"
                }}>
                  {item.icon}
                </span>
                {item.label}
                {item.soon && <span style={{ marginLeft:"auto", fontSize:9, fontWeight:700, color:"var(--muted-2)", textTransform:"uppercase" }}>Soon</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <span className="sidebar-status-dot" />
          Platform Connected
        </div>
      </div>
    </aside>
  );
}
