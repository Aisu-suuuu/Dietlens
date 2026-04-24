"use client";

/**
 * OfflineBanner — a thin top-of-viewport strip that communicates offline
 * state and queue progress without shouting.
 *
 * States (see `useQueueState` below):
 *   - Offline + empty queue: "You're offline — any meals you log will sync later."
 *   - Offline + queue > 0:   "Offline — N queued, will sync when online."
 *   - Online  + queue > 0:   "Syncing N queued meals…"
 *   - Online  + queue = 0:   hidden (no render)
 *
 * Design:
 *   - Chalk-on-iron treatment using --fg-chalk-dust on --bg-ember-black,
 *     bordered top/bottom with --shutter-ring at very low opacity so it
 *     reads as "stripe of tape pressed onto the page" rather than "alert".
 *   - Slides down on appear, slides up on hide via CSS transform transition.
 *   - Respects prefers-reduced-motion (opacity-only).
 *   - Height ~32px, stays above page content via fixed positioning +
 *     safe-area-inset-top so it doesn't collide with notches.
 *
 * The banner does NOT obscure the main content — pages already pad their
 * own top via PageHeader, and the banner is brief enough that a small
 * visual overlap during the transition is not worth the layout-push cost.
 */

import { useEffect, useState, useCallback } from "react";
import { getQueueLength } from "@/lib/offline/queue";

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface QueueState {
  /** navigator.onLine at last check — reactive to online/offline events */
  online: boolean;
  /** Number of meals currently in IndexedDB queue */
  queueLength: number;
  /** True when online AND queue > 0 (draining in progress, nominally) */
  syncing: boolean;
}

/**
 * Reactive hook for queue state used by the banner.
 *
 * Refresh strategy:
 *   - Re-reads queue length on `online`, `offline`, `meal:created`,
 *     `meal:synced`, `meal:deleted`.
 *   - Polls every 2 seconds while offline — cheap fallback for cases where
 *     the queue changes via a mechanism we didn't subscribe to (future
 *     retry buttons, other tabs, etc). When online we rely on events, since
 *     polling online would mask real bugs in the sync pipeline.
 */
export function useQueueState(): QueueState {
  const [online, setOnline] = useState<boolean>(() => {
    // SSR: render as "online" so the banner doesn't flash on hydration.
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });
  const [queueLength, setQueueLength] = useState<number>(0);

  // Wrapped so both the effect and the event listeners can re-use the same
  // read path without creating a new function identity on each render.
  const refreshLength = useCallback(async () => {
    try {
      const n = await getQueueLength();
      setQueueLength(n);
    } catch {
      // IndexedDB disabled (private mode, storage eviction) — treat the
      // queue as empty so the banner hides rather than showing a
      // permanently-offline state with no way to clear it.
      setQueueLength(0);
    }
  }, []);

  // ── Online/offline wiring ─────────────────────────────────────────────────
  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      // Trigger a fresh read — sync will drain entries and fire meal:synced
      // but we still want the banner to show "Syncing N…" until it finishes.
      void refreshLength();
    };
    const onOffline = () => {
      setOnline(false);
      void refreshLength();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refreshLength]);

  // ── Meal event wiring ─────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => void refreshLength();
    window.addEventListener("meal:created", onChange);
    window.addEventListener("meal:synced", onChange);
    window.addEventListener("meal:deleted", onChange);
    return () => {
      window.removeEventListener("meal:created", onChange);
      window.removeEventListener("meal:synced", onChange);
      window.removeEventListener("meal:deleted", onChange);
    };
  }, [refreshLength]);

  // ── Offline polling fallback ──────────────────────────────────────────────
  useEffect(() => {
    // Always take one read on mount so the initial state is correct.
    void refreshLength();

    if (online) return; // Only poll while offline — see hook docstring.

    const id = setInterval(refreshLength, 2_000);
    return () => clearInterval(id);
  }, [online, refreshLength]);

  const syncing = online && queueLength > 0;
  return { online, queueLength, syncing };
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Maps queue state to banner copy. Extracted so the render stays thin and
 * so a future test can assert copy without mounting the whole component.
 */
function messageFor(state: QueueState): string | null {
  const { online, queueLength, syncing } = state;
  if (syncing) {
    return `Syncing ${queueLength} queued meal${queueLength === 1 ? "" : "s"}…`;
  }
  if (!online && queueLength === 0) {
    return "You're offline — any meals you log will sync later.";
  }
  if (!online && queueLength > 0) {
    return `Offline — ${queueLength} queued, will sync when online.`;
  }
  // Online + empty queue: no banner.
  return null;
}

export function OfflineBanner() {
  const state = useQueueState();
  const message = messageFor(state);
  const visible = message !== null;

  return (
    <div
      role="status"
      aria-live="polite"
      // The wrapper is always in the DOM so the slide animation has something
      // to transition FROM. Visibility is driven by `data-visible` + CSS.
      data-visible={visible}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        // Don't let the banner steal clicks when hidden — pointerEvents:none
        // in the non-visible state keeps the hit area clean.
        pointerEvents: visible ? "auto" : "none",
        // Safe-area inset so notched phones don't eat the text.
        paddingTop: "env(safe-area-inset-top)",
        transform: visible ? "translateY(0)" : "translateY(-100%)",
        transition:
          "transform var(--dur-normal, 240ms) var(--ease-shutter, cubic-bezier(0.4, 0, 0.2, 1))",
      }}
    >
      <div
        style={{
          // Thin but readable — 30px of actual band, plus the safe-area
          // padding above.
          minHeight: "30px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Muted cast-iron background; NOT alert-red. The border is the
          // signal, not the fill.
          background: "var(--bg-ember-black, #1a1614)",
          color: "var(--fg-chalk-dust, #9A948A)",
          borderBottom: "1px solid var(--shutter-ring, rgba(232,199,154,0.22))",
          padding: "6px 14px",
          fontFamily:
            "var(--font-inter-tight, ui-sans-serif, system-ui, sans-serif)",
          fontSize: "12px",
          lineHeight: 1.3,
          letterSpacing: "0.02em",
          textAlign: "center",
          // The crumb-line above the band is the visual tell. Keep the
          // border subtle — we're not yelling.
          borderTopColor: "transparent",
        }}
      >
        {/*
          Render the last message even when hiding so the slide-up carries
          the text with it instead of emptying first then animating. The
          fallback string matches the "offline empty" default so screen
          readers never see a silent update.
        */}
        {message ?? "You're offline — any meals you log will sync later."}
      </div>

      <style>{`
        @media (prefers-reduced-motion: reduce) {
          [role="status"][data-visible] {
            transition: opacity var(--dur-fast, 160ms) ease !important;
            transform: none !important;
          }
          [role="status"][data-visible="false"] {
            opacity: 0;
          }
          [role="status"][data-visible="true"] {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
