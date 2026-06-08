import "./globals.css";
import Sidebar from "../components/layout/Sidebar";
import { DateRangeProvider } from "./context/DateRangeContext";

export const metadata = {
  title: "Metrics Flo — Ad Intelligence Platform",
  description: "AI-powered performance marketing analytics for Meta, Google, TikTok & Snapchat"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <DateRangeProvider>
          <div className="app-shell">
            <Sidebar />
            <main className="main">
              {children}
            </main>
          </div>
        </DateRangeProvider>
      </body>
    </html>
  );
}
