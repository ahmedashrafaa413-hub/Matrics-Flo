"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import { useLanguage } from "../../app/context/LanguageContext";

const AUTH_PATHS = ["/login", "/signup", "/auth"];

function isAuthPath(pathname) {
  return AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { direction } = useLanguage();

  if (isAuthPath(pathname)) {
    return children;
  }

  return (
    <div className="app-shell" dir={direction}>
      <Sidebar />

      <main className="main">
        {children}
      </main>
    </div>
  );
}
