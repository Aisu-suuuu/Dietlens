"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Category, MealPhotoRow, MealRow, MealWithPhotos } from "@/lib/supabase/types";
import { MealActions } from "@/components/meal-actions";
import { LOCAL_ID_PREFIX, listQueue } from "@/lib/offline/queue";

/**
 * MealCard accepts either:
 *  - the legacy MealRow shape (rendered as a single-photo card via image_path), or
 *  - a MealWithPhotos (renders the horizontal carousel from photos[]).
 *
 * Wave 1: callers from the dashboard / album detail / meal:created events
 * now always pass MealWithPhotos, but the legacy fallback is kept so any
 * stragglers (e.g. mid-rollout caches) don't crash.
 */
interface MealCardProps {
  meal: MealRow | MealWithPhotos;
  /**
   * Optional explicit marker — meals produced by the offline capture branch
   * pass `pending: true` so the "Queued" badge renders without relying on id
   * string sniffing. Falls back to `meal.id.startsWith(LOCAL_ID_PREFIX)` so
   * consumers that just prepend a MealRow (with the localId as id) also work.
   */
  pending?: boolean;
}

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

/** Has the meal already loaded its photos array? */
function hasPhotos(m: MealRow | MealWithPhotos): m is MealWithPhotos {
  return Array.isArray((m as MealWithPhotos).photos);
}

export function MealCard({ meal, pending }: MealCardProps) {
  // Build the canonical ordered photo list. For meals that pre-date Wave 1
  // (or for events that didn't carry photos[]) we synthesize one entry from
  // image_path so the carousel codepath stays uniform.
  const photos = useMemo<MealPhotoRow[]>(() => {
    if (hasPhotos(meal) && meal.photos.length > 0) {
      return meal.photos.slice().sort((a, b) => a.position - b.position);
    }
    if (meal.image_path) {
      return [
        {
          id: `${meal.id}:cover`,
          meal_id: meal.id,
          image_path: meal.image_path,
          position: 0,
          created_at: meal.created_at,
        },
      ];
    }
    return [];
  }, [meal]);

  const [photoUrls, setPhotoUrls] = useState<(string | null)[]>(() =>
    photos.map(() => null)
  );
  const [imgError, setImgError] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Local category — updated optimistically via meal:updated event
  const [localCategory, setLocalCategory] = useState<Category>(meal.category);

  const isQueued = pending === true || meal.id.startsWith(LOCAL_ID_PREFIX);

  // Long-press detection refs
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null);

  // Carousel scroller ref — used for IntersectionObserver wiring of activeIndex
  const scrollerRef = useRef<HTMLDivElement>(null);

  // ── Resolve each photo to a usable URL ───────────────────────────────────
  useEffect(() => {
    if (!photos.length) return;
    let cancelled = false;
    const createdObjectUrls: string[] = [];

    async function resolveAll() {
      // Queued (offline) path: read blobs from the IDB queue entry, mint
      // object URLs in carousel order. The localId is the meal's id and
      // entry.blobs[position] is what we want.
      if (isQueued) {
        try {
          const queue = await listQueue();
          const entry = queue.find((q) => q.localId === meal.id);
          if (cancelled) return;
          if (!entry) {
            setImgError(true);
            return;
          }
          const urls = photos.map((p) => {
            const blob = entry.blobs?.[p.position];
            if (!blob) return null;
            const u = URL.createObjectURL(blob);
            createdObjectUrls.push(u);
            return u;
          });
          if (!cancelled) setPhotoUrls(urls);
        } catch {
          if (!cancelled) setImgError(true);
        }
        return;
      }

      // Online path: one signed URL per photo, in parallel.
      const supabase = getSupabaseBrowserClient();
      const results = await Promise.all(
        photos.map((p) =>
          supabase.storage
            .from("meal-photos")
            .createSignedUrl(p.image_path, 3600)
        )
      );
      if (cancelled) return;
      const urls = results.map((r) => r.data?.signedUrl ?? null);
      // If every URL came back null we surface the fallback once. A partial
      // failure (some photos missing) still renders the others.
      if (urls.every((u) => u === null)) {
        setImgError(true);
      } else {
        setPhotoUrls(urls);
      }
    }

    void resolveAll();

    return () => {
      cancelled = true;
      for (const u of createdObjectUrls) URL.revokeObjectURL(u);
    };
  }, [photos, isQueued, meal.id]);

  // ── Track active slide via IntersectionObserver ──────────────────────────
  useEffect(() => {
    if (photos.length <= 1) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const slides = scroller.querySelectorAll<HTMLDivElement>("[data-slide-index]");
    if (!slides.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the slide with the highest intersection ratio. Multiple may
        // be partially visible mid-scroll; we want the dominant one.
        let bestIdx = activeIndex;
        let bestRatio = 0;
        for (const e of entries) {
          if (e.intersectionRatio > bestRatio) {
            const idx = Number((e.target as HTMLElement).dataset.slideIndex);
            if (Number.isFinite(idx)) {
              bestIdx = idx;
              bestRatio = e.intersectionRatio;
            }
          }
        }
        setActiveIndex(bestIdx);
      },
      { root: scroller, threshold: [0.5, 0.75, 1] }
    );

    slides.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
    // We intentionally exclude activeIndex from deps — the observer reads it
    // inside the callback but the observer itself shouldn't reset on each
    // active-slide change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  // ── Live event: meal:updated — update tape label without a re-fetch ──────
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
    if (e.button !== 0 && e.pointerType !== "touch") return;
    pointerStartPos.current = { x: e.clientX, y: e.clientY };
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(triggerActions, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!pointerStartPos.current) return;
    const dx = e.clientX - pointerStartPos.current.x;
    const dy = e.clientY - pointerStartPos.current.y;
    // Cancel if pointer moved more than 10px — user is swiping/scrolling
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
    e.preventDefault();
    triggerActions();
  }

  const timestamp = formatLocalTime(meal.created_at);
  const altText = `${localCategory} at ${timestamp}`;
  const showCarousel = photos.length > 1;

  // ── Overlays render once per card (not per slide). ────────────────────────
  function renderOverlay() {
    return (
      <>
        {/* Masking-tape category label — signature element, 0.8° rotation. */}
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
            zIndex: 3,
          }}
        >
          {localCategory}
        </span>

        {/* Chalked timestamp + queued badge — bottom-right */}
        <div
          style={{
            position: "absolute",
            bottom: showCarousel ? "calc(var(--space-sip) + 14px)" : "var(--space-sip)",
            right: "var(--space-sip)",
            display: "flex",
            alignItems: "baseline",
            gap: "6px",
            maxWidth: "calc(100% - var(--space-shelf))",
            userSelect: "none",
            zIndex: 3,
          }}
        >
          {isQueued && (
            <span
              aria-label="Queued — will sync when online"
              style={{
                color: "var(--chalk-ink)",
                fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
                fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 500',
                fontSize: "9.5px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                lineHeight: 1,
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
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
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

        {/* "···" tap-target → MealActions */}
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
            zIndex: 3,
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="3.5" cy="3.5" r="1.4" fill="var(--chalk-ink, rgba(232,199,154,0.62))" />
            <circle cx="7" cy="7" r="1.4" fill="var(--chalk-ink, rgba(232,199,154,0.62))" />
            <circle cx="10.5" cy="10.5" r="1.4" fill="var(--chalk-ink, rgba(232,199,154,0.62))" />
          </svg>
        </button>

        {/* Carousel position dots — only when there is more than one photo. */}
        {showCarousel && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: "var(--space-sip)",
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              gap: "5px",
              zIndex: 3,
              pointerEvents: "none",
            }}
          >
            {photos.map((p, i) => (
              <span
                key={p.id}
                style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "9999px",
                  background:
                    i === activeIndex
                      ? "var(--fg-crema)"
                      : "rgba(232,199,154,0.35)",
                  boxShadow:
                    i === activeIndex
                      ? "0 0 4px rgba(232,199,154,0.55)"
                      : "none",
                  transition: "background var(--dur-fast) var(--ease-out)",
                }}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  // ── Photo area: single image OR scroll-snap carousel ─────────────────────
  function renderPhotoArea() {
    const hasAnyUrl = photoUrls.some((u) => u !== null);

    if (!photos.length || imgError) {
      return (
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
      );
    }

    if (!hasAnyUrl) {
      return (
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
      );
    }

    // Single-photo: no scroll snap, behaves identically to the legacy card.
    if (photos.length === 1) {
      return (
        <div style={{ position: "relative", width: "100%" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrls[0] ?? ""}
            alt={altText}
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              verticalAlign: "bottom",
              WebkitTouchCallout: "none",
              pointerEvents: "none",
            }}
            onError={() => setImgError(true)}
          />
          {renderOverlay()}
        </div>
      );
    }

    // Multi-photo: horizontal scroll-snap carousel.
    return (
      <div style={{ position: "relative", width: "100%" }}>
        <div
          ref={scrollerRef}
          role="region"
          aria-label={`${photos.length} photos — swipe to view`}
          style={{
            display: "flex",
            overflowX: "auto",
            overflowY: "hidden",
            scrollSnapType: "x mandatory",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
            width: "100%",
          }}
        >
          {photos.map((p, i) => (
            <div
              key={p.id}
              data-slide-index={i}
              style={{
                flex: "0 0 100%",
                scrollSnapAlign: "start",
                scrollSnapStop: "always",
                position: "relative",
              }}
            >
              {photoUrls[i] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={photoUrls[i] ?? ""}
                  alt={`${altText} (${i + 1} of ${photos.length})`}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "auto",
                    verticalAlign: "bottom",
                    WebkitTouchCallout: "none",
                    pointerEvents: "none",
                  }}
                  onError={() => {
                    // Individual photo error — replace its slot with a gap
                    // rather than collapsing the whole card.
                    setPhotoUrls((prev) => {
                      const next = prev.slice();
                      next[i] = null;
                      return next;
                    });
                  }}
                />
              ) : (
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
                      fontFamily:
                        "var(--font-fraunces), ui-serif, Georgia, serif",
                      fontVariationSettings:
                        '"opsz" 11, "SOFT" 100, "wght" 400',
                      fontSize: "12px",
                    }}
                  >
                    Developing…
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        <style>{`
          [role="region"][aria-label$="swipe to view"]::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        {renderOverlay()}
      </div>
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
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={handleContextMenu}
      >
        {renderPhotoArea()}

        <style>{`
          @keyframes mealCardEntry {
            from { opacity: 0; transform: translateY(-8px); }
            to   { opacity: 1; transform: translateY(0); }
          }

          @keyframes tapeStick {
            from { opacity: 0; transform: rotate(0deg) scale(0.96); }
            to   { opacity: 1; transform: rotate(0.8deg) scale(1); }
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
