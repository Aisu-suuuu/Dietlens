import type { Metadata, Viewport } from "next";

// --bg-cast-iron from styles/tokens.css (dark-mode canvas color)
const THEME_COLOR = "#0E0B0A";

/**
 * Base metadata for every page.
 * The layout agent spreads this into the layout's exported `metadata` object:
 *
 *   import { appMetadata } from "@/lib/metadata";
 *   export const metadata: Metadata = { ...appMetadata };
 *
 * app/manifest.ts is auto-linked by Next.js App Router — no `manifest` key needed here.
 */
export const appMetadata: Metadata = {
  title: { default: "DietLens", template: "%s · DietLens" },
  description: "Snap and archive every meal. Zero friction.",
  applicationName: "DietLens",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DietLens",
  },
  formatDetection: { telephone: false },
};

/**
 * Viewport export for every page.
 * The layout agent re-exports this from layout.tsx:
 *
 *   import { appViewport } from "@/lib/metadata";
 *   export const viewport: Viewport = { ...appViewport };
 *
 * In Next.js 13+, viewport config must be exported separately from metadata.
 */
export const appViewport: Viewport = {
  themeColor: THEME_COLOR,
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};
