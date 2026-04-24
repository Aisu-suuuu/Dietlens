"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Category, MealRow } from "@/lib/supabase/types";
import { MealActions } from "@/components/meal-actions";
import { LOCAL_ID_PREFIX, listQueue } from "@/lib/offline/queue";

interface MealCardProps {
  meal: MealRow;
  /**
   * Optional explicit marker — meals produced by the offline capture branch
   * pass `pending: true` so the "Queued" badge renders without relying on id
   * string sniffing. Falls back to `meal.id.startsWith(LOCAL_ID_PREFIX)` so
   * consumers that just prepend a MealRow (with the localId as id) also work.
   */
  pending?: boolean;
}

/**
 * Formats a date string to "h:mm a" local time — e.g. "1:42 PM".
 * The timestamp is stored in ISO 8601 UTC; we parse it via the
 * Date constructor which automatically converts to the browser's
 * local timezone.
 */
function formatLocalTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// Long-press hold threshold in ms
const LONG_PRESS_MS = 500;

/**
 * MealCard — the contact-sheet strip.
 *
 * Design mandates (from system.md):
 * - Photo fills edge-to-edge; no border, no outer radius.
 * - Masking-tape label top-left: thermal-paper cream, Fraunces ink,
 *   rotated 0.8°, soft inner shadow (tape has thickness), 2px radius.
 * - Chalked timestamp bottom-right: crema at ~62% opacity, Fraunces
 *   opsz:11 SOFT:100, 11px, "chalk-on-iron" feel via text-shadow.
 *
 * Long-press (500ms) or right-click opens <MealActions />.
 * A subtle "···" chalked tap target in the top-right corner also opens it.
 * On meal:updated for this card's id, the category label updates live.
 */
export function MealCard({ meal, pending }: MealCardProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  // Local category state — updated optimistically via meal:updated event
  const [localCategory, setLocalCategory] = useState<Category>(meal.category);

  // A meal is "queued" if the parent explicitly told us OR if the id is one
  // of our local placeholders. The latter covers the optimistic-prepend path
  // where the list holds a MealRow built from a CaptureResult.
  const isQueued = pending === true || meal.id.startsWith(LOCAL_ID_PREFIX);

  // Long-press detection refs
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  // Track whether pointer moved enough to cancel long-press
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null);

  // Image source —
  //   queued meals: build a blob: URL from the IDB entry so the user sees
  //     the photo they just took without a network round trip.
  //   synced meals: request a 1-hour signed URL from Supabase storage.
  // Both paths converge on `signedUrl` so the downstream render is identical.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    if (isQueued) {
      // Find the matching queue entry — listQueue is small (O(queue length)
      // which is typically single digits) so a full scan is fine. Memoising
      // this via a context would add complexity for little gain.
      listQueue()
        .then((queue) => {
          if (cancelled) return;
          const entry = queue.find((q) => q.localId === meal.id);
          if (!entry) {
            setImgError(true);
            return;
          }
          objectUrl = URL.createObjectURL(entry.blob);
          setSignedUrl(objectUrl);
        })
        .catch(() => {
          if (!cancelled) setImgError(true);
        });

      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }

    const supabase = getSupabaseBrowserClient();

    supabase.storage
      .from("meal-photos")
      .createSignedUrl(meal.image_path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          setImgError(true);
        } else {
          setSignedUrl(data.signedUrl);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [meal.image_path, meal.id, isQueued]);

  // ── Live event: meal:updated ─────────────────────────────────────────────
  // When the user moves this card to a new category via MealActions, update
  // the displayed masking-tape label immediately without a page re-fetch.
  useEffect(() => {
    function handleMealUpdated(e: Event) {
      const detail = (e as CustomEvent<{ mealId: string; updates: Partial<MealRow> }>).detail;
      if (detail?.mealId !== meal.id) return;
      if (detail.updates?.category) {
        setLocalCategory(detail.updates.category);
      }
    }
    window.addEventListener("meal:updated", handleMealUpdated);
    return () => window.removeEventListener("meal:updated", handleMealUpdated);
  }, [meal.id]);

  // ── Long-press helpers ───────────────────────────────────────────────────
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressTriggered.current = false;
    pointerStartPos.current = null;
  }, []);

  const triggerActions = useCallback(() => {
    longPressTriggered.current = true;
    navigator.vibrate?.(15);
    setActionsOpen(true);
  }, []);

  function handlePointerDown(e: React.PointerEvent) {
    // Only primary button (left click / touch) starts long-press
    if (e.button !== 0 && e.pointerType !== "touch") return;
    pointerStartPos.current = { x: e.clientX, y: e.clientY };
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(triggerActions, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!pointerStartPos.current) return;
    const dx = e.clientX - pointerStartPos.current.x;
    const dy = e.clientY - pointerStartPos.current.y;
    // Cancel if finger/pointer moved more than 10px — user is scrolling
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      cancelLongPress();
    }
  }

  function handlePointerUp() {
    cancelLongPress();
  }

  function handlePointerCancel() {
    cancelLongPress();
  }

  function handleContextMenu(e: React.MouseEvent) {
    // Right-click / long-press secondary context menu → open actions
    e.preventDefault();
    triggerActions();
  }

  const timestamp = formatLocalTime(meal.created_at);
  const altText = `${localCategory} at ${timestamp}`;

  // ── Shared overlay elements (tape label + timestamp + ··· dot target) ────
  // These are rendered inside both the photo and the error state so the
  // localCategory state always reflects the latest value.
  function renderOverlay() {
    return (
      <>
        {/* ── Masking-tape category label ─────────────────────────────────
            Signature element. MUST keep 0.8° rotation.
        ─────────────────────────────────────────────────────────────────── */}
        <span
          aria-label={`Category: ${localCategory}`}
          style={{
            position: "absolute",
            top: "var(--space-sip)",
            left: "var(--space-sip)",
            background: "var(--tape-surface)",
            color: "var(--tape-ink)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
            fontSize: "11px",
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            lineHeight: 1,
            padding: "4px 8px",
            borderRadius: "var(--radius-tape)",
            transform: "rotate(0.8deg)",
            transformOrigin: "top left",
            boxShadow: [
              "0 1px 3px var(--tape-shadow)",
              "inset 0 1px 0 rgba(255,255,255,0.18)",
              "inset 0 -1px 0 rgba(0,0,0,0.12)",
              "inset 1px 0 0 rgba(255,255,255,0.10)",
              "inset -1px 0 0 rgba(0,0,0,0.10)",
            ].join(", "),
            animation: "tapeStick 180ms var(--ease-shutter) both",
            userSelect: "none",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          {localCategory}
        </span>

        {/* ── Chalked timestamp (+ queued badge) ─────────────────────────
            The timestamp is chalk-on-iron. When this card is the optimistic
            placeholder for an offline capture, we prepend a small "QUEUED"
            mark in the same chalk aesthetic — no bright alert colour — so
            the user can tell the photo isn't on the server yet without the
            card becoming a different visual thing. Kept inline with the
            timestamp to respect the existing layout contract.
        ─────────────────────────────────────────────────────────────────── */}
        <div
          style={{
            position: "absolute",
            bottom: "var(--space-sip)",
            right: "var(--space-sip)",
            display: "flex",
            alignItems: "baseline",
            gap: "6px",
            maxWidth: "calc(100% - var(--space-shelf))",
            userSelect: "none",
          }}
        >
          {isQueued && (
            <span
              aria-label="Queued — will sync when online"
              style={{
                color: "var(--chalk-ink)",
                fontFamily:
                  "var(--font-fraunces), ui-serif, Georgia, serif",
                fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 500',
                fontSize: "9.5px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                lineHeight: 1,
                // Hairline chalk border so it reads as "stamped", not typed.
                border: "1px solid var(--chalk-ink)",
                borderRadius: "2px",
                padding: "2px 5px",
                textShadow: [
                  "0 0 4px rgba(0,0,0,0.55)",
                  "0 1px 2px rgba(0,0,0,0.40)",
                ].join(", "),
              }}
            >
              Queued
            </span>
          )}
          <time
            dateTime={meal.created_at}
            style={{
              color: "var(--chalk-ink)",
              fontFamily:
                "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
              fontFeatureSettings: '"tnum"',
              fontSize: "11px",
              lineHeight: 1,
              textShadow: [
                "0 0 4px rgba(0,0,0,0.55)",
                "0 1px 2px rgba(0,0,0,0.40)",
              ].join(", "),
            }}
          >
            {timestamp}
          </time>
        </div>

        {/* ── Secondary tap target: "···" chalked dot cluster ──────────────
            Top-right corner. Subtler than a standard menu icon — three
            small chalk dots arranged diagonally. 44×44 hit area, but only
            ~10px visual footprint. The user discovers it by hunting;
            long-press is the primary method.
        ─────────────────────────────────────────────────────────────────── */}
        <button
          type="button"
          aria-label="Meal options"
          onClick={(e) => {
            e.stopPropagation();
            triggerActions();
          }}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            // 44×44 tap target — WCAG minimum
            width: "44px",
            height: "44px",
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            WebkitTapHighlightColor: "transparent",
            touchAction: "manipulation",
            userSelect: "none",
            outline: "none",
          }}
          onFocus={(e) => {
            (e.currentTarget).style.outline = "2px solid var(--focus-ring)";
            (e.currentTarget).style.outlineOffset = "2px";
          }}
          onBlur={(e) => {
            (e.currentTarget).style.outline = "";
            (e.currentTarget).style.outlineOffset = "";
          }}
        >
          {/* Three chalk dots — diagonal cluster, chalk aesthetic */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            {/* Top-left dot */}
            <circle cx="3.5" cy="3.5" r="1.4" fill="var(--chalk-ink, rgba(232,199,154,0.62))" />
            {/* Center dot */}
            <circle cx="7" cy="7" r="1.4" fill="var(--chalk-ink, rgba(232,199,154,0.62))" />
            {/* Bottom-right dot */}
            <circle cx="10.5" cy="10.5" r="1.4" fill="var(--chalk-ink, rgba(232,199,154,0.62))" />
          </svg>
        </button>
      </>
    );
  }

  return (
    <>
      <article
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: 0,
          background: "var(--bg-stove-black)",
          animation: "mealCardEntry var(--dur-normal) var(--ease-shutter) both",
          // Prevent text selection during long-press hold
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={handleContextMenu}
      >
        {/* ── Photo ───────────────────────────────────────────────────── */}
        {signedUrl && !imgError ? (
          <div style={{ position: "relative", width: "100%" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signedUrl}
              alt={altText}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
                verticalAlign: "bottom",
                // Prevent long-press image save dialog on mobile
                WebkitTouchCallout: "none",
                pointerEvents: "none",
              }}
              onError={() => setImgError(true)}
            />
            {renderOverlay()}
          </div>
        ) : imgError ? (
          /* Graceful fallback — keep the darkroom aesthetic */
          <div
            style={{
              background: "var(--bg-ember-black)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "180px",
              position: "relative",
            }}
          >
            <span
              style={{
                color: "var(--fg-smoke)",
                fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
                fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
                fontSize: "13px",
              }}
            >
              Photo unavailable
            </span>
            {renderOverlay()}
          </div>
        ) : (
          /* Loading skeleton — chalk-dust pulse, no spinner */
          <div
            style={{
              background: "var(--bg-ember-black)",
              minHeight: "220px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                color: "var(--fg-smoke)",
                fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
                fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
                fontSize: "12px",
                animation: "chalkPulse 1.6s var(--ease-in-out) infinite",
              }}
            >
              Developing…
            </span>
          </div>
        )}

        {/*
          Keyframe definitions scoped to this component via a style tag.
          These reference only CSS tokens — no hardcoded values.
        */}
        <style>{`
          @keyframes mealCardEntry {
            from {
              opacity: 0;
              transform: translateY(-8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes tapeStick {
            from {
              opacity: 0;
              transform: rotate(0deg) scale(0.96);
            }
            to {
              opacity: 1;
              transform: rotate(0.8deg) scale(1);
            }
          }

          @keyframes chalkPulse {
            0%, 100% { opacity: 0.35; }
            50%       { opacity: 0.65; }
          }

          @media (prefers-reduced-motion: reduce) {
            @keyframes mealCardEntry {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes tapeStick {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes chalkPulse {
              0%, 100% { opacity: 0.5; }
            }
          }
        `}</style>
      </article>

      {/* MealActions sheet — rendered outside the article so it's not clipped */}
      <MealActions
        meal={{ ...meal, category: localCategory }}
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
      />
    </>
  );
}
