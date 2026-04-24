"use client";

import { useRef, useState, useCallback } from "react";
import { CategorySheet } from "./category-sheet";
import { showToast } from "./toast";
import { captureAndUploadMeal } from "@/lib/upload/capture";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAnonSession } from "@/lib/auth/anon-session";
import type { Category } from "@/lib/supabase/types";

/**
 * Fab — shutter-ring FAB wired to the full meal capture pipeline.
 *
 * Flow:
 *   1. User taps FAB → CategorySheet opens
 *   2. User picks a category → category stored in ref, file input clicked
 *   3. Camera/picker opens → user selects photo
 *   4. File runs through captureAndUploadMeal (compress → upload → insert)
 *   5. Success: toast + haptic + `meal:created` CustomEvent dispatched on window
 *   6. Error: toast + console.error
 *
 * The `onCategorySelected` prop is kept as optional for test/storybook use,
 * but default behavior is the internal capture pipeline.
 */
export interface FabProps {
  /** Optional override — called instead of the capture pipeline when provided. */
  onCategorySelected?: (category: Category) => void;
}

export function Fab({ onCategorySelected }: FabProps) {
  const [open, setOpen] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fabRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Store the pending category between sheet-selection and file-pick
  const pendingCategoryRef = useRef<Category | null>(null);

  const { userId } = useAnonSession();

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleOpen() {
    if (uploading) return;
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

  const handleCategorySelected = useCallback(
    (category: Category) => {
      setOpen(false);

      // If a custom override is provided, call it and stop here.
      if (onCategorySelected) {
        onCategorySelected(category);
        return;
      }

      if (!userId) {
        showToast({ message: "Not signed in — please wait a moment", icon: "error" });
        return;
      }

      pendingCategoryRef.current = category;
      // Programmatically open the native camera/file picker
      fileInputRef.current?.click();
    },
    [onCategorySelected, userId]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];

      // ── User cancelled the picker — silent, do nothing ───────────────────
      if (!file) return;

      // Reset the input so the same file can be selected again later
      e.target.value = "";

      const category = pendingCategoryRef.current;
      if (!category) {
        console.error("[Fab] file selected but no pending category");
        return;
      }

      if (!userId) {
        showToast({ message: "Not signed in — try again", icon: "error" });
        return;
      }

      setUploading(true);

      try {
        const supabase = getSupabaseBrowserClient();
        const result = await captureAndUploadMeal({ file, category, userId, supabase });

        // ── Success ─────────────────────────────────────────────────────────
        navigator.vibrate?.(50);
        showToast({ message: `Logged to ${result.category}`, icon: "check" });

        // Dispatch window event so the dashboard can prepend the new meal
        window.dispatchEvent(
          new CustomEvent("meal:created", { detail: result })
        );
      } catch (err: unknown) {
        // ── Error ────────────────────────────────────────────────────────────
        console.error("[Fab] capture error:", err);

        // Surface HEIC-specific message verbatim from compressImage
        const msg =
          err instanceof Error && err.message.includes("HEIC")
            ? "Set iPhone camera to 'Most Compatible' in Settings → Camera → Formats"
            : "Couldn't save — try again";

        showToast({ message: msg, icon: "error", duration: 4000 });
      } finally {
        setUploading(false);
        pendingCategoryRef.current = null;
      }
    },
    [userId]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/*
        Hidden file input — accept images, prefer rear camera (capture="environment").
        Kept in the DOM but never visible.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChange}
      />

      {/*
        Position: fixed, bottom-center.
        Bottom offset = safe-area + nav height (56px) + gap (12px) + FAB radius (32px)
        so the FAB's centre sits 12px above the top of the nav.
        -translate-x-1/2 + left-1/2 = horizontal centre.
      */}
      <button
        ref={fabRef}
        type="button"
        aria-label={uploading ? "Uploading meal…" : "Log a meal"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={uploading}
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
          cursor: uploading ? "wait" : "pointer",
          opacity: uploading ? 0.65 : 1,
          // Ambient glow: softlight halo when not pressed
          boxShadow: pressing
            ? `0 0 0 0 var(--shutter-glow)`
            : `0 0 0 6px var(--shutter-glow), 0 4px 16px rgba(0,0,0,0.55)`,
          // Outer scale: subtle shrink on press (the ring closing)
          transition: `
            box-shadow var(--dur-fast) var(--ease-shutter),
            transform var(--dur-fast) var(--ease-shutter),
            opacity var(--dur-normal) var(--ease-out)
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
        <ShutterRingSvg pressing={pressing} uploading={uploading} />
      </button>

      <CategorySheet
        open={open}
        onClose={() => setOpen(false)}
        onSelect={handleCategorySelected}
        triggerRef={fabRef}
      />

      {/*
        Keyframes scoped to this component.
        shutterPulse: the inner ring scales down briefly then recovers — like a shutter blade closing.
        uploadPulse: gentle opacity throb while uploading.
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

        .shutter-inner--uploading {
          animation: uploadPulse 1.2s var(--ease-in-out) infinite;
        }

        @keyframes uploadPulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1.0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .shutter-inner,
          .shutter-outer {
            transition: none;
          }
          .shutter-inner--uploading {
            animation: none;
            opacity: 0.7;
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
// On upload: inner throbs gently.
// Color: --shutter-ring (var(--safelight) amber).
// NO fill, NO plus icon, NO camera icon.

interface ShutterRingSvgProps {
  pressing: boolean;
  uploading: boolean;
}

function ShutterRingSvg({ pressing, uploading }: ShutterRingSvgProps) {
  const innerClass = [
    "shutter-inner",
    pressing ? "shutter-inner--pressing" : "",
    uploading ? "shutter-inner--uploading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const outerClass = [
    "shutter-outer",
    pressing ? "shutter-outer--pressing" : "",
  ]
    .filter(Boolean)
    .join(" ");

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
        className={outerClass}
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
        className={innerClass}
      />
      {/*
        Micro centre dot — the shutter's focal point.
        2px radius filled, same safelight colour at 60% opacity.
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
