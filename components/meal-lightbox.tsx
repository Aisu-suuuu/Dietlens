"use client";

/**
 * MealLightbox — full-screen modal that wraps a MealCard for viewing.
 *
 * The grid view (MealTile) renders compact thumbnails on the feed. Tapping
 * a tile opens this lightbox, which shows the full carousel + tape label +
 * chalked timestamp + ··· actions exactly as the old full-width card did.
 *
 * Dismiss:
 *   - Tap the backdrop (anywhere outside the card)
 *   - Press Escape
 *   - Swipe down past a threshold (touch only)
 *
 * Body scroll is locked while open. Safe-area insets respected so the close
 * affordance never sits under a notch.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MealRow, MealPhotoRow, MealWithPhotos } from "@/lib/supabase/types";
import { MealCard } from "@/components/meal-card";

interface MealLightboxProps {
  meal: (MealRow | MealWithPhotos) & { photos?: MealPhotoRow[] };
  open: boolean;
  onClose: () => void;
  pending?: boolean;
}

const SWIPE_DOWN_DISMISS_PX = 90;

export function MealLightbox({ meal, open, onClose, pending }: MealLightboxProps) {
  const [mounted, setMounted] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const cardWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted || !open) return null;

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartY.current === null) return;
    const dy = (e.changedTouches[0]?.clientY ?? 0) - touchStartY.current;
    touchStartY.current = null;
    if (dy > SWIPE_DOWN_DISMISS_PX) onClose();
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Meal photo viewer"
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(14, 11, 10, 0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "calc(env(safe-area-inset-top) + 12px) 12px calc(env(safe-area-inset-bottom) + 12px) 12px",
        animation: "lightboxFade var(--dur-normal) var(--ease-out) both",
      }}
    >
      {/* Close affordance — fixed top-right, sits on top of the card */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top) + 8px)",
          right: "12px",
          width: "44px",
          height: "44px",
          borderRadius: "9999px",
          background: "rgba(14, 11, 10, 0.55)",
          border: "1px solid var(--border-crumb)",
          color: "var(--fg-crema)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontSize: "16px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 72,
          WebkitTapHighlightColor: "transparent",
        }}
      >
        ✕
      </button>

      <div
        ref={cardWrapperRef}
        style={{
          width: "100%",
          maxWidth: "min(720px, 100%)",
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px)",
          overflowY: "auto",
          overflowX: "hidden",
          borderRadius: "var(--radius-polaroid)",
          background: "var(--bg-stove-black)",
          animation: "lightboxRise var(--dur-normal) var(--ease-shutter) both",
          // Prevent the card's pointer events from dismissing the lightbox
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <MealCard meal={meal} pending={pending} />
      </div>

      <style>{`
        @keyframes lightboxFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes lightboxRise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes lightboxFade { from { opacity: 0; } to { opacity: 1; } }
          @keyframes lightboxRise { from { opacity: 0; } to { opacity: 1; } }
        }
      `}</style>
    </div>,
    document.body
  );
}
