"use client";

/**
 * meal-actions.tsx
 *
 * Bottom-sheet that surfaces Delete + Move-to actions on a MealCard.
 * Triggered by long-press (500ms hold) or the secondary tap target (···) on
 * the card itself — see meal-card.tsx.
 *
 * Aesthetic: mirrors CategorySheet — thermal-paper handle bar, cast-iron
 * surface, Fraunces text. Slide-up from bottom, backdrop dim, escape key.
 *
 * Events dispatched on success:
 *   meal:deleted  →  { mealId: string }
 *   meal:updated  →  { mealId: string, updates: { category: Category } }
 */

import { useEffect, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/supabase/types";
import type { Category, MealRow } from "@/lib/supabase/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { deleteMeal, updateMealCategory } from "@/lib/meals/mutations";
import { showToast } from "@/components/toast";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MealActionsProps {
  meal: MealRow;
  open: boolean;
  onClose: () => void;
}

// ── View state machine ────────────────────────────────────────────────────────
// "menu"    — two primary action buttons
// "move"    — nested category picker (5 categories, excludes current)
// "confirm" — inline delete confirmation
type View = "menu" | "move" | "confirm";

// ── MealActions ───────────────────────────────────────────────────────────────

export function MealActions({ meal, open, onClose }: MealActionsProps) {
  const [view, setView] = useState<View>("menu");
  const [inflight, setInflight] = useState(false);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  // Reset to menu view whenever sheet opens
  useEffect(() => {
    if (open) setView("menu");
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (view !== "menu") {
          setView("menu");
        } else {
          onClose();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, view, onClose]);

  // Focus first button on open / view change
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      firstButtonRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, view]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ── Delete handler ──────────────────────────────────────────────────────────
  async function handleDelete() {
    if (inflight) return;
    setInflight(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await deleteMeal(supabase, { id: meal.id, image_path: meal.image_path });
      window.dispatchEvent(
        new CustomEvent("meal:deleted", { detail: { mealId: meal.id } })
      );
      onClose();
      showToast({ message: "Deleted.", icon: "check" });
    } catch (err) {
      console.error("[MealActions] delete failed:", err);
      showToast({ message: "Couldn't delete — try again", icon: "error" });
    } finally {
      setInflight(false);
    }
  }

  // ── Move handler ────────────────────────────────────────────────────────────
  async function handleMove(newCategory: Category) {
    if (inflight) return;
    setInflight(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await updateMealCategory(supabase, meal.id, newCategory);
      window.dispatchEvent(
        new CustomEvent("meal:updated", {
          detail: { mealId: meal.id, updates: { category: newCategory } },
        })
      );
      onClose();
      showToast({ message: `Moved to ${newCategory}`, icon: "check" });
    } catch (err) {
      console.error("[MealActions] move failed:", err);
      showToast({ message: "Couldn't move — try again", icon: "error" });
    } finally {
      setInflight(false);
    }
  }

  // ── Other categories (exclude current) ─────────────────────────────────────
  const otherCategories = CATEGORIES.filter((c) => c !== meal.category);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => !inflight && onClose()}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 59,
          background: "rgba(14, 11, 10, 0.72)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity var(--dur-normal) var(--ease-out)",
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          view === "move" ? "Move meal to…" :
          view === "confirm" ? "Confirm delete" :
          "Meal actions"
        }
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 60,
          background: "var(--bg-skillet-edge)",
          borderRadius: "var(--radius-polaroid) var(--radius-polaroid) 0 0",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform var(--dur-slow) var(--ease-shutter)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + var(--space-counter))",
          maxHeight: "85dvh",
          overflowY: "auto",
        }}
      >
        {/* Handle bar */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: "var(--space-sip)",
            paddingBottom: "var(--space-sip)",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "4px",
              borderRadius: "var(--radius-shutter)",
              background: "var(--shutter-ring, var(--fg-smoke))",
              opacity: 0.40,
            }}
          />
        </div>

        {/* ── Menu view ── */}
        {view === "menu" && (
          <MenuView
            meal={meal}
            inflight={inflight}
            firstButtonRef={firstButtonRef}
            onMoveClick={() => setView("move")}
            onDeleteClick={() => setView("confirm")}
          />
        )}

        {/* ── Move view ── */}
        {view === "move" && (
          <MoveView
            otherCategories={otherCategories}
            inflight={inflight}
            firstButtonRef={firstButtonRef}
            onSelect={handleMove}
            onBack={() => setView("menu")}
          />
        )}

        {/* ── Confirm delete view ── */}
        {view === "confirm" && (
          <ConfirmView
            inflight={inflight}
            firstButtonRef={firstButtonRef}
            onConfirm={handleDelete}
            onCancel={() => setView("menu")}
          />
        )}
      </div>

      <style>{`
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"] {
            transition-duration: 1ms !important;
          }
        }
      `}</style>
    </>
  );
}

// ── MenuView ──────────────────────────────────────────────────────────────────

interface MenuViewProps {
  meal: MealRow;
  inflight: boolean;
  firstButtonRef: React.RefObject<HTMLButtonElement | null>;
  onMoveClick: () => void;
  onDeleteClick: () => void;
}

function MenuView({ meal, inflight, firstButtonRef, onMoveClick, onDeleteClick }: MenuViewProps) {
  return (
    <div style={{ paddingInline: "var(--space-counter)", paddingBottom: "var(--space-bite)" }}>
      {/* Category context */}
      <p
        style={{
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
          fontSize: "11px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--fg-smoke)",
          marginBottom: "var(--space-plate)",
          marginTop: 0,
        }}
      >
        {meal.category}
      </p>

      {/* Move to… */}
      <ActionButton
        ref={firstButtonRef}
        disabled={inflight}
        onClick={onMoveClick}
      >
        <span aria-hidden="true" style={{ fontSize: "15px", lineHeight: 1 }}>↗</span>
        <span>Move to…</span>
      </ActionButton>

      {/* Divider */}
      <div
        aria-hidden="true"
        style={{
          height: "1px",
          background: "var(--border-crumb)",
          marginBlock: "var(--space-bite)",
        }}
      />

      {/* Delete */}
      <ActionButton
        disabled={inflight}
        onClick={onDeleteClick}
        destructive
      >
        <span aria-hidden="true" style={{ fontSize: "14px", lineHeight: 1 }}>✕</span>
        <span>Delete</span>
      </ActionButton>
    </div>
  );
}

// ── MoveView ──────────────────────────────────────────────────────────────────

interface MoveViewProps {
  otherCategories: readonly Category[];
  inflight: boolean;
  firstButtonRef: React.RefObject<HTMLButtonElement | null>;
  onSelect: (c: Category) => void;
  onBack: () => void;
}

function MoveView({ otherCategories, inflight, firstButtonRef, onSelect, onBack }: MoveViewProps) {
  return (
    <div style={{ paddingInline: "var(--space-counter)", paddingBottom: "var(--space-bite)" }}>
      {/* Back + heading row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sip)",
          marginBottom: "var(--space-plate)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          disabled={inflight}
          style={ghostButtonStyle}
          aria-label="Back to meal actions"
        >
          ‹ Back
        </button>

        <p
          style={{
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
            fontSize: "16px",
            color: "var(--fg-thermal-paper)",
            margin: 0,
          }}
        >
          Move to…
        </p>
      </div>

      {/* Category list — 5 items, 1 column */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-bite)" }}>
        {otherCategories.map((category, idx) => (
          <ActionButton
            key={category}
            ref={idx === 0 ? firstButtonRef : undefined}
            disabled={inflight}
            onClick={() => onSelect(category)}
          >
            <TapeAccent />
            <span>{category}</span>
          </ActionButton>
        ))}
      </div>
    </div>
  );
}

// ── ConfirmView ───────────────────────────────────────────────────────────────

interface ConfirmViewProps {
  inflight: boolean;
  firstButtonRef: React.RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmView({ inflight, firstButtonRef, onConfirm, onCancel }: ConfirmViewProps) {
  return (
    <div style={{ paddingInline: "var(--space-counter)", paddingBottom: "var(--space-bite)" }}>
      <p
        style={{
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
          fontSize: "16px",
          color: "var(--fg-thermal-paper)",
          marginTop: 0,
          marginBottom: "var(--space-bite)",
        }}
      >
        Delete this meal?
      </p>
      <p
        style={{
          fontFamily: "var(--font-inter-tight, var(--font-fraunces)), ui-sans-serif, system-ui, sans-serif",
          fontSize: "13px",
          color: "var(--fg-smoke)",
          lineHeight: 1.5,
          marginTop: 0,
          marginBottom: "var(--space-plate)",
        }}
      >
        Are you sure? This cannot be undone.
      </p>

      {/* Cancel */}
      <ActionButton
        ref={firstButtonRef}
        disabled={inflight}
        onClick={onCancel}
      >
        <span>Cancel</span>
      </ActionButton>

      <div
        aria-hidden="true"
        style={{
          height: "1px",
          background: "var(--border-crumb)",
          marginBlock: "var(--space-bite)",
        }}
      />

      {/* Delete Forever */}
      <ActionButton
        disabled={inflight}
        onClick={onConfirm}
        destructive
        loading={inflight}
      >
        <span>{inflight ? "Deleting…" : "Delete Forever"}</span>
      </ActionButton>
    </div>
  );
}

// ── ActionButton ──────────────────────────────────────────────────────────────
// Reusable button with darkroom aesthetics.

import { forwardRef } from "react";

interface ActionButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  loading?: boolean;
}

const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton({ children, onClick, disabled, destructive, loading }, ref) {
    const color = destructive ? "var(--smoked-brick)" : "var(--fg-crema)";

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sip)",
          width: "100%",
          minHeight: "var(--hit-target)",
          padding: "var(--space-sip) 0",
          background: "none",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          color,
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
          fontSize: "17px",
          letterSpacing: "var(--tracking-tight, -0.01em)",
          textAlign: "left",
          opacity: loading ? 0.55 : disabled && !loading ? 0.4 : 1,
          transition: "opacity var(--dur-fast) var(--ease-out)",
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
          userSelect: "none",
          outline: "none",
          borderRadius: "var(--radius-knob)",
        }}
        onFocus={(e) => {
          (e.currentTarget as HTMLButtonElement).style.outline =
            "2px solid var(--focus-ring)";
          (e.currentTarget as HTMLButtonElement).style.outlineOffset = "2px";
        }}
        onBlur={(e) => {
          (e.currentTarget as HTMLButtonElement).style.outline = "";
          (e.currentTarget as HTMLButtonElement).style.outlineOffset = "";
        }}
      >
        {children}
      </button>
    );
  }
);

// ── TapeAccent ────────────────────────────────────────────────────────────────
// Tiny masking-tape stripe — echoes category tiles in CategorySheet.

function TapeAccent() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "20px",
        height: "3px",
        background: "var(--tape-surface, #F2EBDD)",
        borderRadius: "var(--radius-tape)",
        opacity: 0.7,
        transform: "rotate(-0.6deg)",
        flexShrink: 0,
      }}
    />
  );
}

// ── Ghost button style (Back link) ────────────────────────────────────────────

const ghostButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "4px 0",
  cursor: "pointer",
  color: "var(--fg-smoke)",
  fontFamily: "var(--font-inter-tight, var(--font-fraunces)), ui-sans-serif, system-ui, sans-serif",
  fontSize: "13px",
  letterSpacing: "0.02em",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  userSelect: "none",
};
