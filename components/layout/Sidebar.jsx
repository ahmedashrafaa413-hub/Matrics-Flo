"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  { title: "Dashboard",        href: "/dashboard",   icon: "⬡" },
  { title: "Google Analytics", href: "/ga",           icon: "◈" },
  { title: "Connections",      href: "/connections",  icon: "⟐" },
  { title: "Campaigns",        href: "/campaigns",    icon: "◫" },
  { title: "Ad Sets",          href: "/adsets",       icon: "◻" },
  { title: "Ads",              href: "/ads",          icon: "▣" },
  { title: "Settings",         href: "/settings",     icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">M</div>
          <div className="sidebar-brand">
            <span className="sidebar-brand-name">
              Metrics <em>Flo</em>
            </span>
            <span className="sidebar-brand-sub">Ad Intelligence</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Main</div>
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${pathname === item.href ? "active" : ""}`}
          >
            <span className="nav-item-icon">{item.icon}</span>
            {item.title}
          </Link>
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
