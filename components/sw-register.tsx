"use client";

import { useEffect } from "react";

/**
 * Registers /public/sw.js as a service worker.
 * Only runs in production — dev HMR and SW interact poorly.
 * The layout agent renders <SwRegister /> inside <body> to wire this up.
 */
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        console.warn("SW registration failed:", err);
      });
    }
  }, []);

  return null;
}
