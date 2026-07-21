"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

const AUTH_PATHS = ["/login", "/signup", "/auth"];

function isAuthPath(pathname) {
  return AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

export default function AppShell({ children }) {
  const pathname = usePathname();

  if (isAuthPath(pathname)) {
    return children;
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main">
        {children}
      </main>
    </div>
  );
}
