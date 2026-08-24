"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import PlatformLogo from "../PlatformLogo";

const channels = [
  {
    label: "Intelligence Engine",
    href: "/intelligence",
    icon: "🧠",
    badge: "AI"
  },
  {
    label: "Performance Overview",
    href: "/performance-overview",
    icon: "📊",
    badge: "New"
  },
  {
    label: "Meta Ads",
    href: "/meta",
    platform: "meta"
  },
  {
    label: "Google Analytics",
    href: "/ga",
    platform: "ga4"
  },
  {
    label: "Salla",
    href: "/salla",
    platform: "salla"
  },
  {
    label: "Snapchat Ads",
    href: "/snapchat",
    platform: "snapchat"
  },
  {
    label: "Shopify",
    href: "/shopify",
    platform: "shopify",
    soon: true
  }
];

const accountLinks = [
  {
    label: "Agency Overview",
    href: "/agency",
    icon: "🏢"
  },
  {
    label: "Connections",
    href: "/connections",
    icon: "◇"
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "⚙️"
  }
];

function isActive(pathname, href) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ children, active }) {
  return (
    <span
      className="nav-item-icon"
      style={{
        width: 24,
        height: 24,
        borderRadius: 8,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
        color: active ? "#ffffff" : "var(--muted)",
        fontSize: 12,
        fontWeight: 900,
        flexShrink: 0
      }}
    >
      {children}
    </span>
  );
}

function SidebarLink({ item }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);

  if (item.soon) {
    return (
      <div
        className="nav-item nav-item-soon"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 14,
          color: "rgba(255,255,255,0.28)",
          cursor: "not-allowed",
          opacity: 0.65
        }}
      >
        <NavIcon active={false}>{item.platform ? <PlatformLogo platform={item.platform} size={18} decorative /> : item.icon}</NavIcon>

        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            flex: 1
          }}
        >
          {item.label}
        </span>

        <span
          style={{
            fontSize: 9,
            fontWeight: 900,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.25)"
          }}
        >
          Soon
        </span>
      </div>
    );
  }

  return (
    <Link
      className={`nav-item${active ? " active" : ""}`}
      href={item.href}
      prefetch={false}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 14,
        textDecoration: "none",
        color: active ? "var(--text)" : "var(--muted)",
        background: active
          ? "linear-gradient(135deg,rgba(101,87,255,0.24),rgba(0,213,178,0.08))"
          : "transparent",
        border: active ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
        transition: "all 0.18s ease"
      }}
    >
      <NavIcon active={active}>{item.platform ? <PlatformLogo platform={item.platform} size={18} decorative /> : item.icon}</NavIcon>

      <span
        style={{
          fontSize: 14,
          fontWeight: active ? 900 : 700,
          flex: 1
        }}
      >
        {item.label}
      </span>

      {item.badge && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 900,
            color: "#06d6a0",
            background: "rgba(6,214,160,0.12)",
            border: "1px solid rgba(6,214,160,0.25)",
            padding: "3px 7px",
            borderRadius: 999
          }}
        >
          {item.badge}
        </span>
      )}

      {active && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#06d6a0",
            boxShadow: "0 0 12px rgba(6,214,160,0.8)"
          }}
        />
      )}
    </Link>
  );
}

export default function Sidebar() {
  return (
    <aside
      className="sidebar metrics-sidebar"
      style={{
        width: 280,
        minHeight: "100vh",
        background: "rgba(7,9,20,0.98)",
        borderRight: "1px solid var(--border)",
        padding: 18,
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        gap: 18
      }}
    >
      <Link
        className="sidebar-header"
        href="/dashboard"
        prefetch={false}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          textDecoration: "none",
          padding: "8px 8px 16px",
          borderBottom: "1px solid var(--border)"
        }}
      >
        {/* Icon mark only — viewBox cropped to just the bars square */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 307.88 307.88" style={{ width: 36, height: 36, flexShrink: 0 }}>
          <rect x=".5" y=".5" width="306.88" height="306.88" rx="22" ry="22" fill="#6366f1" opacity="0.1"/>
          <rect x=".5" y=".5" width="306.88" height="306.88" rx="22" ry="22" fill="none" stroke="#6366f1" strokeWidth="1.5" opacity="0.35"/>
          <rect x="47.71" y="212.96" width="41.31" height="59.02" rx="5" ry="5" fill="#6366f1" opacity="0.25"/>
          <rect x="100.83" y="168.7" width="41.31" height="103.28" rx="5" ry="5" fill="#6366f1" opacity="0.55"/>
          <rect x="153.94" y="118.53" width="41.31" height="153.44" rx="5" ry="5" fill="#6366f1" opacity="0.82"/>
          <rect x="218.86" y="53.61" width="41.31" height="218.36" rx="5" ry="5" fill="#06d6a0"/>
        </svg>

        {/* Wordmark as HTML text */}
        <div>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize: 19, fontWeight: 700, color: "#f0f3ff", lineHeight: 1, letterSpacing: "-0.3px" }}>
            Metrics<span style={{ color: "#06d6a0" }}>Flo</span>
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#4a5278", letterSpacing: "0.2em", textTransform: "uppercase", marginTop: 4 }}>
            Ad Intelligence
          </div>
        </div>
      </Link>

      <div
        className="sidebar-workspace"
        style={{
          background: "rgba(255,255,255,0.035)",
          border: "1px solid var(--border)",
          borderRadius: 18,
          padding: 12
        }}
      >
        <button
          type="button"
          style={{
            width: "100%",
            border: "none",
            background: "transparent",
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: 800,
            fontSize: 14
          }}
        >
          <span>Select workspace</span>

          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 10,
              background: "linear-gradient(135deg,#6557ff,#00d5b2)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 12,
              fontWeight: 900
            }}
          >
            ↗
          </span>
        </button>
      </div>

      <nav
        className="sidebar-nav sidebar-nav-channels"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6
        }}
      >
        <div
          style={{
            color: "var(--muted)",
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            padding: "8px 12px"
          }}
        >
          Channels
        </div>

        {channels.map((item) => (
          <SidebarLink key={item.href} item={item} />
        ))}
      </nav>

      <nav
        className="sidebar-nav sidebar-nav-account"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          borderTop: "1px solid var(--border)",
          paddingTop: 14
        }}
      >
        <div
          style={{
            color: "var(--muted)",
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            padding: "8px 12px"
          }}
        >
          Account
        </div>

        {accountLinks.map((item) => (
          <SidebarLink key={item.href} item={item} />
        ))}
      </nav>

      <div className="sidebar-footer" style={{ marginTop: "auto" }}>
        <div
          style={{
            border: "1px solid rgba(6,214,160,0.25)",
            background: "rgba(6,214,160,0.08)",
            borderRadius: 16,
            padding: "13px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10
          }}
        >
          <span
            style={{
              color: "#06d6a0",
              fontSize: 13,
              fontWeight: 900
            }}
          >
            Platform Connected
          </span>

          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#06d6a0",
              boxShadow: "0 0 12px rgba(6,214,160,0.8)"
            }}
          />
        </div>
      </div>
    </aside>
  );
}
