"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  {
    title: "Dashboard",
    href: "/dashboard",
  },
  {
    title: "Connections",
    href: "/connections",
  },
  {
    title: "Campaigns",
    href: "/campaigns",
  },
  {
    title: "Ad Sets",
    href: "/adsets",
  },
  {
    title: "Ads",
    href: "/ads",
  },
  {
    title: "Settings",
    href: "/settings",
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Ad Intelligence</h2>
        <span>Marketing Platform</span>
      </div>

      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${
              pathname === item.href ? "active" : ""
            }`}
          >
            {item.title}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
