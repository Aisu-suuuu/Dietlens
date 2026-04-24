import type { Metadata, Viewport } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { appMetadata, appViewport } from "@/lib/metadata";
import SessionBootstrap from "@/components/session-bootstrap";
import { SwRegister } from "@/components/sw-register";
import { BottomNav } from "@/components/bottom-nav";
import { Fab } from "@/components/fab";
import { ToastHost } from "@/components/toast";
import { OfflineBanner } from "@/components/offline-banner";
import "./globals.css";

// ── Fonts ────────────────────────────────────────────────────────────────────
// Variable names injected into CSS must match what tokens.css + globals.css
// reference: --font-fraunces, --font-inter-tight, --font-jetbrains-mono.

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  // SOFT (0–100) and opsz are both confirmed valid axes in next/font Fraunces type.
  axes: ["SOFT", "opsz"],
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// ── Metadata & Viewport (module-level, not inside component) ─────────────────
export const metadata: Metadata = { ...appMetadata };
export const viewport: Viewport = { ...appViewport };

// ── Root Layout ──────────────────────────────────────────────────────────────
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${interTight.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/* Client-only bootstraps — both render null, side-effects only */}
        <SwRegister />
        <SessionBootstrap />

        {/*
          Offline/queue banner — fixed to the top of the viewport; slides in
          when offline or while a drain is in progress. Mounted ABOVE the
          main shell so it sits over the header content rather than pushing
          the layout down.
        */}
        <OfflineBanner />

        <div className="min-h-[100dvh] flex flex-col">
          {/* Main content area: leaves space for fixed bottom nav + safe area */}
          <main className="flex-1 pb-[calc(env(safe-area-inset-bottom)+72px)]">
            {children}
          </main>

          <BottomNav />
          <Fab />
          <ToastHost />
        </div>
      </body>
    </html>
  );
}
