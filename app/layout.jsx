import "./globals.css";
import AppShell from "../components/layout/AppShell";
import { DateRangeProvider } from "./context/DateRangeContext";

export const metadata = {
  title: "Metrics Flo — Ad Intelligence Platform",
  description:
    "AI-powered performance marketing analytics for Meta, Google, TikTok & Snapchat"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>

      <body>
        <DateRangeProvider>
          <AppShell>{children}</AppShell>
        </DateRangeProvider>
      </body>
    </html>
  );
}
