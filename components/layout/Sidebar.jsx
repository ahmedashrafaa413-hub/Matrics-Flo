"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  BrainCircuit,
  BarChart3,
  Facebook,
  BarChart2,
  ShoppingBag,
  Ghost,
  Layers,
  Building2,
  Plug,
  Settings,
  ChevronRight,
  Wifi,
  Sun,
  Moon,
  Filter,
} from "lucide-react";
import LanguageSwitcher from "../LanguageSwitcher";
import AccountMenu from "./AccountMenu";
import { useLanguage } from "../../app/context/LanguageContext";

function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("mf-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = stored ? stored === "dark" : prefersDark;
    setIsDark(dark);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("mf-theme", next ? "dark" : "light");
  };

  return (
    <button onClick={toggle} className="theme-toggle-btn" title={isDark ? "وضع النهار" : "وضع الليل"}>
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
      <span>{isDark ? "نهاري" : "ليلي"}</span>
    </button>
  );
}

const channels = [
  {
    labelKey: "navigation.analytics",
    href: "/analytics",
    Icon: BrainCircuit,
    badge: "AI",
  },
  {
    labelKey: "navigation.performance",
    href: "/performance-overview",
    Icon: BarChart3,
    badgeKey: "common.new",
  },
  {
    labelKey: "navigation.funnel",
    href: "/funnel",
    Icon: Filter,
    badgeKey: "common.new",
  },
  {
    labelKey: "navigation.meta",
    href: "/meta",
    Icon: Facebook,
  },
  {
    labelKey: "navigation.googleAnalytics",
    href: "/ga",
    Icon: BarChart2,
  },
  {
    labelKey: "navigation.salla",
    href: "/salla",
    Icon: ShoppingBag,
  },
  {
    labelKey: "navigation.snapchat",
    href: "/snapchat",
    Icon: Ghost,
  },
  {
    labelKey: "navigation.shopify",
    href: "/shopify",
    Icon: Layers,
    soon: true,
  },
];

const accountLinks = [
  {
    labelKey: "navigation.agency",
    href: "/agency",
    Icon: Building2,
  },
  {
    labelKey: "navigation.connections",
    href: "/connections",
    Icon: Plug,
  },
  {
    labelKey: "navigation.settings",
    href: "/settings",
    Icon: Settings,
  },
];

function isActive(pathname, href) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({ item }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const active = isActive(pathname, item.href);
  const label = t(item.labelKey);
  const { Icon } = item;

  if (item.soon) {
    return (
      <div className="nav-item nav-item-soon">
        <span className="nav-item-icon-wrap">
          <Icon size={16} />
        </span>
        <span className="nav-item-label">{label}</span>
        <span className="nav-badge nav-badge-soon">{t("common.soon")}</span>
      </div>
    );
  }

  return (
    <Link
      className={`nav-item${active ? " active" : ""}`}
      href={item.href}
      prefetch={false}
    >
      <span className={`nav-item-icon-wrap${active ? " active" : ""}`}>
        <Icon size={16} />
      </span>

      <span className="nav-item-label">{label}</span>

      {item.badgeKey && (
        <span className="nav-badge nav-badge-accent">{t(item.badgeKey)}</span>
      )}

      {item.badge && (
        <span className="nav-badge nav-badge-primary">{item.badge}</span>
      )}

      {active && <span className="nav-active-dot" />}
    </Link>
  );
}

export default function Sidebar() {
  const { t } = useLanguage();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <Link className="sidebar-logo" href="/dashboard" prefetch={false}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 307.88 307.88"
          className="sidebar-logo-icon"
        >
          <rect
            x=".5" y=".5" width="306.88" height="306.88"
            rx="22" ry="22" fill="#6366f1" opacity="0.1"
          />
          <rect
            x=".5" y=".5" width="306.88" height="306.88"
            rx="22" ry="22" fill="none" stroke="#6366f1"
            strokeWidth="1.5" opacity="0.35"
          />
          <rect x="47.71" y="212.96" width="41.31" height="59.02" rx="5" ry="5" fill="#6366f1" opacity="0.25" />
          <rect x="100.83" y="168.7" width="41.31" height="103.28" rx="5" ry="5" fill="#6366f1" opacity="0.55" />
          <rect x="153.94" y="118.53" width="41.31" height="153.44" rx="5" ry="5" fill="#6366f1" opacity="0.82" />
          <rect x="218.86" y="53.61" width="41.31" height="218.36" rx="5" ry="5" fill="#06d6a0" />
        </svg>

        <div className="sidebar-logo-text">
          <div className="sidebar-logo-name">
            Metrics<span className="sidebar-logo-accent">Flo</span>
          </div>
          <div className="sidebar-logo-sub">{t("brand.subtitle")}</div>
        </div>
      </Link>

      {/* Workspace Switcher */}
      <div className="sidebar-workspace">
        <button type="button" className="sidebar-workspace-btn">
          <span className="sidebar-workspace-label">{t("common.selectWorkspace")}</span>
          <span className="sidebar-workspace-arrow">
            <ChevronRight size={14} />
          </span>
        </button>
      </div>

      {/* Channels Nav */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">{t("common.channels")}</div>
        {channels.map((item) => (
          <SidebarLink key={item.href} item={item} />
        ))}
      </nav>

      {/* Account Nav */}
      <nav className="sidebar-nav sidebar-nav-account">
        <div className="sidebar-section-label">{t("common.account")}</div>
        {accountLinks.map((item) => (
          <SidebarLink key={item.href} item={item} />
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <ThemeToggle />
        <LanguageSwitcher />
        <AccountMenu />
        <div className="sidebar-connected">
          <Wifi size={14} className="sidebar-connected-icon" />
          <span className="sidebar-connected-label">{t("common.connected")}</span>
          <span className="sidebar-connected-dot" />
        </div>
      </div>
    </aside>
  );
}
