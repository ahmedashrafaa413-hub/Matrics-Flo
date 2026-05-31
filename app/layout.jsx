import "./globals.css";
import Sidebar from "../components/layout/Sidebar";

export const metadata = {
  title: "AdIntelligence",
  description: "AI-powered marketing intelligence platform"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
