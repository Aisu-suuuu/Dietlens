"use client";

import { useEffect, useRef, RefObject } from "react";
import { CATEGORIES } from "@/lib/supabase/types";
import type { Category } from "@/lib/supabase/types";

interface CategorySheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (category: Category) => void;
  /** Ref to the FAB button — focus is restored here when the sheet closes. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * CategorySheet — bottom sheet for meal category selection.
 *
 * Design:
 * - Slides up from the bottom. Pure CSS translate-y transition (no dialog lib).
 * - Backdrop: semi-transparent cast-iron overlay that fades in/out.
 * - Handle bar: thin safelight strip at top of sheet (visual affordance).
 * - 2-column grid of 6 category tiles.
 * - Each tile: Fraunces display type + masking-tape stripe accent.
 * - Escape closes (desktop). Focus trap: first button on open, FAB on close.
 * - Reduced motion: transitions collapse to near-zero via tokens.
 * - z-index: 60 (above FAB at 50, above nav at 40).
 */
export function CategorySheet({
  open,
  onClose,
  onSelect,
  triggerRef,
}: CategorySheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  // ── Escape key ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // ── Focus management ────────────────────────────────────────────────────────
  // When open: focus the first category button.
  // When close: restore focus to the FAB trigger.
  useEffect(() => {
    if (open) {
      // Small rAF to wait for the transition to begin so the element is visible
      const raf = requestAnimationFrame(() => {
        firstButtonRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(raf);
    } else {
      triggerRef?.current?.focus({ preventScroll: true });
    }
  }, [open, triggerRef]);

  // ── Prevent body scroll when open ──────────────────────────────────────────
  useEffect(() => {
    if (open) {
      // Store current overflow and lock scroll
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
  }, [open]);

  return (
    <>
      {/*
        Backdrop — always rendered in DOM so transitions work.
        Fades from opacity-0 (closed) to opacity-1 (open).
        Pointer events only active when open (prevents invisible click blocker).
      */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 59,
          background: "rgba(14, 11, 10, 0.72)",  // cast-iron at ~72% — darkroom dim
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity var(--dur-normal) var(--ease-out)",
        }}
      />

      {/*
        Sheet — slides up from bottom.
        translate-y: 100% when closed (fully off-screen), 0 when open.
        Rendered above backdrop (z-60) and above nav (z-40) and FAB (z-50).
      */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a meal category"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 60,
          background: "var(--bg-skillet-edge)",  // elev-3 — highest surface
          borderRadius: "var(--radius-polaroid) var(--radius-polaroid) 0 0",  // 10px top corners only
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform var(--dur-slow) var(--ease-shutter)",
          // Respect iOS safe area at the bottom
          paddingBottom: "calc(env(safe-area-inset-bottom) + var(--space-counter))",
          // Prevent sheet from being taller than the viewport
          maxHeight: "85dvh",
          overflowY: "auto",
        }}
      >
        {/* ── Handle bar ──────────────────────────────────────────────────── */}
        {/*
          Thin safelight strip — visual affordance that this surface can be dismissed.
          MVP: visual only, no drag-to-close. The affordance is still honest because
          tapping the backdrop or pressing Escape achieves the same result.
        */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: "var(--space-sip)",       // 12px
            paddingBottom: "var(--space-sip)",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "4px",
              borderRadius: "var(--radius-shutter)",
              background: "var(--shutter-ring)",
              opacity: 0.40,
            }}
          />
        </div>

        {/* ── Sheet header ────────────────────────────────────────────────── */}
        <div
          style={{
            paddingInline: "var(--space-counter)",  // 24px
            paddingBottom: "var(--space-plate)",     // 16px
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
              fontSize: "18px",
              letterSpacing: "var(--tracking-tight)",
              color: "var(--fg-thermal-paper)",
              margin: 0,
            }}
          >
            What did you eat?
          </p>
        </div>

        {/* ── Category grid ───────────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-bite)",          // 8px
            paddingInline: "var(--space-counter)",
          }}
        >
          {CATEGORIES.map((category, index) => (
            <CategoryTile
              key={category}
              category={category}
              index={index}
              ref={index === 0 ? firstButtonRef : undefined}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>

      <style>{`
        @media (prefers-reduced-motion: reduce) {
          /* Tokens already collapse --dur-* to 1ms, but be explicit for the sheet */
          [role="dialog"] {
            transition-duration: 1ms !important;
          }
        }
      `}</style>
    </>
  );
}

// ── CategoryTile ─────────────────────────────────────────────────────────────
// Each tile: background ember-black surface, Fraunces category name,
// masking-tape accent stripe (a single horizontal stripe, not a full label —
// avoids redundancy with the full tape label on meal cards).

import { forwardRef } from "react";

interface CategoryTileProps {
  category: Category;
  index: number;
  onSelect: (category: Category) => void;
}

const CategoryTile = forwardRef<HTMLButtonElement, CategoryTileProps>(
  function CategoryTile({ category, index, onSelect }, ref) {
    // Slight tape rotation variance per category — same pattern as meal card
    // Six values, never zero, matching the system.md intent.
    const TAPE_TILTS: readonly number[] = [
      -0.8, 0.6, -0.5, 0.9, -0.7, 0.4,
    ] as const;
    const tilt = TAPE_TILTS[index % TAPE_TILTS.length];

    return (
      <button
        ref={ref}
        type="button"
        onClick={() => onSelect(category)}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          // Tile sizing — 1:1 feel, min 44px tap target height
          minHeight: "88px",
          padding: "var(--space-sip)",        // 12px
          paddingTop: "var(--space-plate)",   // 16px — room for tape stripe
          background: "var(--bg-ember-black)",
          borderRadius: "var(--radius-polaroid)",  // 10px
          border: "1px solid var(--border-crumb)",
          cursor: "pointer",
          // Reset button defaults
          appearance: "none",
          WebkitAppearance: "none",
          // Typography
          textAlign: "left",
          // Interaction states
          transition: [
            "background var(--dur-fast) var(--ease-out)",
            "border-color var(--dur-fast) var(--ease-out)",
            "transform var(--dur-fast) var(--ease-shutter)",
          ].join(", "),
          // Touch
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
          userSelect: "none",
          outline: "none",
        }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)";
          (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-skillet-edge)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-ember)";
        }}
        onPointerUp={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "";
          (e.currentTarget as HTMLButtonElement).style.background = "";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "";
        }}
        onPointerLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "";
          (e.currentTarget as HTMLButtonElement).style.background = "";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "";
        }}
        onPointerCancel={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "";
          (e.currentTarget as HTMLButtonElement).style.background = "";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "";
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--focus-ring)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 0 2px var(--focus-ring)";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "";
        }}
      >
        {/*
          Masking-tape accent stripe — echoes the tape label on meal cards.
          A thin strip at the top of the tile: thermal-paper cream, slightly rotated.
          Shorter than the full tape label — just an accent stripe, not a duplicate label.
          The category name is below it in Fraunces, so the stripe is pure visual.
        */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "var(--space-sip)",          // 12px from top
            left: "var(--space-sip)",         // 12px from left
            width: "28px",
            height: "4px",
            background: "var(--tape-surface)",
            borderRadius: "var(--radius-tape)",   // 2px
            transform: `rotate(${tilt}deg)`,
            transformOrigin: "center left",
            boxShadow: "0 1px 2px var(--tape-shadow)",
            opacity: 0.85,
          }}
        />

        {/* Category name in Fraunces display settings */}
        <span
          style={{
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 100, "wght" 500',
            fontSize: "15px",
            letterSpacing: "var(--tracking-tight)",
            color: "var(--fg-crema)",
            lineHeight: 1.15,
          }}
        >
          {category}
        </span>
      </button>
    );
  }
);
