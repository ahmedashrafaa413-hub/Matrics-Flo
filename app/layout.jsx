import "./globals.css";
import AppShell from "../components/layout/AppShell";
import { DateRangeProvider } from "./context/DateRangeContext";
import { LanguageProvider } from "./context/LanguageContext";

export const metadata = {
  title: "Metrics Flo — Ad Intelligence Platform",
  description:
    "AI-powered performance marketing analytics for Meta, Google, TikTok & Snapchat"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>

      <body suppressHydrationWarning>
        <LanguageProvider>
          <DateRangeProvider>
            <AppShell>{children}</AppShell>
          </DateRangeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
