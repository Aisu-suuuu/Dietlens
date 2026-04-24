"use client";

import { useRef, useState } from "react";
import { CategorySheet } from "./category-sheet";
import type { Category } from "@/lib/supabase/types";

export interface FabProps {
  onCategorySelected?: (category: Category) => void;
}

/**
 * Fab — the shutter-ring FAB.
 *
 * Design mandate (system.md §4 + T2 direction):
 * - Bottom-center, not bottom-right. Thumb-reach when the other hand is occupied.
 * - A double-ring outlined circle in safelight amber (--shutter-ring). NO plus icon.
 * - On press: inner ring scales inward (shutter closing), 380ms ease-shutter.
 * - Sits at z-50 (BottomNav is z-40). Floats 12px above nav (56px tall + safe-area).
 * - 64px outer diameter, meets 44px minimum tap-target.
 * - Haptic: navigator.vibrate(25) on click (optional, best-effort).
 *
 * Integration note: layout mounting is T12's responsibility (Wave 2 capture flow).
 */
export function Fab({ onCategorySelected }: FabProps) {
  const [open, setOpen] = useState(false);
  const [pressing, setPressing] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);

  function handleOpen() {
    navigator.vibrate?.(25);
    setOpen(true);
  }

  function handlePointerDown() {
    setPressing(true);
  }

  function handlePointerUp() {
    setPressing(false);
  }

  function handlePointerLeave() {
    setPressing(false);
  }

  return (
    <>
      {/*
        Position: fixed, bottom-center.
        Bottom offset = safe-area + nav height (56px) + gap (12px) + FAB radius (32px)
        so the FAB's center sits 12px above the top of the nav.
        -translate-x-1/2 + left-1/2 = horizontal center.
      */}
      <button
        ref={fabRef}
        type="button"
        aria-label="Log a meal"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleOpen}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
        style={{
          position: "fixed",
          bottom: "calc(env(safe-area-inset-bottom) + 56px + 12px)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50,
          // Reset browser button styles
          appearance: "none",
          WebkitAppearance: "none",
          border: "none",
          padding: 0,
          margin: 0,
          // Sizing — 64px outer, ensures ≥44px tap target
          width: "64px",
          height: "64px",
          borderRadius: "var(--radius-shutter)",
          // Shutter core: cast-iron canvas so the rings are visible against it
          background: "var(--shutter-core)",
          cursor: "pointer",
          // Ambient glow: softlight halo when not pressed
          boxShadow: pressing
            ? `0 0 0 0 var(--shutter-glow)`
            : `0 0 0 6px var(--shutter-glow), 0 4px 16px rgba(0,0,0,0.55)`,
          // Outer scale: subtle shrink on press (the ring closing)
          transition: `
            box-shadow var(--dur-fast) var(--ease-shutter),
            transform var(--dur-fast) var(--ease-shutter)
          `,
          // Touch — prevent double-tap zoom on mobile
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
          userSelect: "none",
          // Focus-visible ring (keyboard/a11y)
          outline: "none",
        }}
      >
        {/* Shutter-ring SVG — two concentric stroked circles, no fill, no plus */}
        <ShutterRingSvg pressing={pressing} />

        {/* Focus ring via :focus-visible (CSS-in-JS below handles it) */}
      </button>

      <CategorySheet
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(category) => {
          setOpen(false);
          onCategorySelected?.(category);
        }}
        triggerRef={fabRef}
      />

      {/*
        Keyframes scoped to this component.
        shutterPulse: the inner ring scales down briefly then recovers — like a shutter blade closing.
        Triggered by .fab-pressing class added via React state.
      */}
      <style>{`
        .fab-btn:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 3px;
        }

        .shutter-inner {
          transform-origin: center;
          transform-box: fill-box;
          transition:
            transform var(--dur-slow) var(--ease-shutter),
            opacity var(--dur-fast) var(--ease-shutter);
        }

        .shutter-inner--pressing {
          transform: scale(0.62);
        }

        .shutter-outer {
          transform-origin: center;
          transform-box: fill-box;
          transition:
            transform var(--dur-fast) var(--ease-shutter),
            opacity var(--dur-fast) var(--ease-shutter);
        }

        .shutter-outer--pressing {
          transform: scale(0.94);
        }

        @media (prefers-reduced-motion: reduce) {
          .shutter-inner,
          .shutter-outer {
            transition: none;
          }
        }
      `}</style>
    </>
  );
}

// ── ShutterRingSvg ────────────────────────────────────────────────────────────
// Two concentric stroked circles:
//   outer: r=28, stroke 1.5px at 40% opacity — the "aperture housing"
//   inner: r=21, stroke 2px at 90% opacity — the "aperture blades"
// On press: inner scales to 0.62 (blades closing), outer scales to 0.94 (housing contracts).
// Color: --shutter-ring (var(--safelight) amber).
// NO fill, NO plus icon, NO camera icon.

interface ShutterRingSvgProps {
  pressing: boolean;
}

function ShutterRingSvg({ pressing }: ShutterRingSvgProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="64"
      height="64"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", pointerEvents: "none" }}
    >
      {/* Outer ring: housing */}
      <circle
        cx="32"
        cy="32"
        r="28"
        fill="none"
        stroke="var(--shutter-ring)"
        strokeWidth="1.5"
        strokeOpacity="0.40"
        className={`shutter-outer${pressing ? " shutter-outer--pressing" : ""}`}
      />
      {/* Inner ring: aperture blades — this is the one that pulses inward */}
      <circle
        cx="32"
        cy="32"
        r="21"
        fill="none"
        stroke="var(--shutter-ring)"
        strokeWidth="2"
        strokeOpacity="0.90"
        className={`shutter-inner${pressing ? " shutter-inner--pressing" : ""}`}
      />
      {/*
        Micro center dot — the shutter's focal point.
        2px radius filled, same safelight color at 60% opacity.
        NOT a plus icon — it is the aperture's vanishing point.
      */}
      <circle
        cx="32"
        cy="32"
        r="2"
        fill="var(--shutter-ring)"
        fillOpacity="0.60"
      />
    </svg>
  );
}
