"use client";

/**
 * MealTile — compact 4:5 rectangle thumbnail for the feed grid.
 *
 * Shows the cover photo (photos[0] from MealWithPhotos, or image_path from
 * legacy MealRow), tape label, chalked time, and a "+N" badge when there
 * are multiple photos. Tap opens MealLightbox with the full carousel.
 *
 * Queued (offline) meals draw their cover from the first blob in the
 * matching IDB queue entry — same approach as MealCard.
 */

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  Category,
  MealPhotoRow,
  MealRow,
  MealWithPhotos,
} from "@/lib/supabase/types";
import { LOCAL_ID_PREFIX, listQueue } from "@/lib/offline/queue";
import { MealLightbox } from "@/components/meal-lightbox";

interface MealTileProps {
  meal: MealRow | MealWithPhotos;
  pending?: boolean;
}

function hasPhotos(m: MealRow | MealWithPhotos): m is MealWithPhotos {
  return Array.isArray((m as MealWithPhotos).photos);
}

function formatLocalTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function MealTile({ meal, pending }: MealTileProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [open, setOpen] = useState(false);
  // Local category state — mirrors MealCard so the tile updates instantly
  // when MealActions inside the lightbox fires meal:updated.
  const [localCategory, setLocalCategory] = useState<Category>(meal.category);

  const isQueued = pending === true || meal.id.startsWith(LOCAL_ID_PREFIX);

  const photoCount = useMemo(() => {
    if (hasPhotos(meal)) return meal.photos.length || (meal.image_path ? 1 : 0);
    return meal.image_path ? 1 : 0;
  }, [meal]);

  const coverPath = useMemo<string | null>(() => {
    if (hasPhotos(meal) && meal.photos.length > 0) {
      const sorted = meal.photos
        .slice()
        .sort((a, b) => a.position - b.position);
      return sorted[0].image_path;
    }
    return meal.image_path ?? null;
  }, [meal]);

  // Resolve cover image URL
  useEffect(() => {
    if (!coverPath) {
      setImgError(true);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;

    if (isQueued) {
      // Pull blob[0] from the IDB queue entry
      listQueue()
        .then((queue) => {
          if (cancelled) return;
          const entry = queue.find((q) => q.localId === meal.id);
          const blob = entry?.blobs?.[0];
          if (!blob) {
            setImgError(true);
            return;
          }
          objectUrl = URL.createObjectURL(blob);
          setCoverUrl(objectUrl);
        })
        .catch(() => {
          if (!cancelled) setImgError(true);
        });
    } else {
      const supabase = getSupabaseBrowserClient();
      supabase.storage
        .from("meal-photos")
        .createSignedUrl(coverPath, 3600)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data?.signedUrl) {
            setImgError(true);
          } else {
            setCoverUrl(data.signedUrl);
          }
        });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [coverPath, isQueued, meal.id]);

  // Listen for category updates so the tape label stays in sync after a Move
  useEffect(() => {
    function handleMealUpdated(e: Event) {
      const detail = (e as CustomEvent<{ mealId: string; updates: Partial<MealRow> }>).detail;
      if (detail?.mealId !== meal.id) return;
      if (detail.updates?.category) setLocalCategory(detail.updates.category);
    }
    window.addEventListener("meal:updated", handleMealUpdated);
    return () => window.removeEventListener("meal:updated", handleMealUpdated);
  }, [meal.id]);

  const timestamp = formatLocalTime(meal.created_at);
  const altText = `${localCategory} at ${timestamp}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open meal — ${altText}`}
        style={{
          appearance: "none",
          background: "var(--bg-stove-black)",
          border: "none",
          padding: 0,
          margin: 0,
          width: "100%",
          aspectRatio: "4 / 5",
          borderRadius: "var(--radius-polaroid)",
          overflow: "hidden",
          position: "relative",
          cursor: "pointer",
          // Hairline warm-grain ring matches the AlbumTile aesthetic
          boxShadow: [
            "0 2px 8px rgba(0,0,0,0.45)",
            "0 0 0 1px var(--border-crumb)",
          ].join(", "),
          WebkitTapHighlightColor: "transparent",
          touchAction: "manipulation",
          // Subtle entry animation — same shutter ease as MealCard
          animation: "tileEntry var(--dur-normal) var(--ease-shutter) both",
        }}
      >
        {/* Cover image */}
        {coverUrl && !imgError ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={coverUrl}
            alt={altText}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              pointerEvents: "none",
              WebkitTouchCallout: "none",
            }}
            onError={() => setImgError(true)}
          />
        ) : imgError ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "var(--bg-ember-black)",
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
                fontSize: "11px",
                opacity: 0.7,
              }}
            >
              Photo unavailable
            </span>
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "var(--bg-ember-black)",
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
                fontSize: "11px",
                animation: "tilePulse 1.6s var(--ease-in-out) infinite",
              }}
            >
              developing…
            </span>
          </div>
        )}

        {/* Masking-tape category label — signature element */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "var(--space-sip)",
            left: "var(--space-sip)",
            background: "var(--tape-surface)",
            color: "var(--tape-ink)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
            fontSize: "9.5px",
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            lineHeight: 1,
            padding: "3px 6px",
            borderRadius: "var(--radius-tape)",
            transform: "rotate(0.8deg)",
            transformOrigin: "top left",
            boxShadow: [
              "0 1px 3px var(--tape-shadow)",
              "inset 0 1px 0 rgba(255,255,255,0.18)",
              "inset 0 -1px 0 rgba(0,0,0,0.12)",
            ].join(", "),
            userSelect: "none",
            zIndex: 2,
          }}
        >
          {localCategory}
        </span>

        {/* +N badge for multi-photo meals — top-right, opposite the tape */}
        {photoCount > 1 && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "var(--space-sip)",
              right: "var(--space-sip)",
              background: "rgba(14, 11, 10, 0.65)",
              color: "var(--fg-crema)",
              fontFamily:
                "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 500',
              fontFeatureSettings: '"tnum"',
              fontSize: "10px",
              lineHeight: 1,
              padding: "3px 6px",
              borderRadius: "var(--radius-tape)",
              border: "1px solid rgba(232,199,154,0.22)",
              userSelect: "none",
              zIndex: 2,
            }}
          >
            +{photoCount - 1}
          </span>
        )}

        {/* Chalked time — bottom-right with queued badge if applicable */}
        <div
          style={{
            position: "absolute",
            bottom: "var(--space-sip)",
            right: "var(--space-sip)",
            display: "flex",
            alignItems: "baseline",
            gap: "5px",
            userSelect: "none",
            zIndex: 2,
            // Subtle ink-on-iron text shadow so it always reads on any photo
          }}
        >
          {isQueued && (
            <span
              aria-label="Queued"
              style={{
                color: "var(--chalk-ink)",
                fontFamily:
                  "var(--font-fraunces), ui-serif, Georgia, serif",
                fontVariationSettings:
                  '"opsz" 11, "SOFT" 100, "wght" 500',
                fontSize: "8.5px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                lineHeight: 1,
                border: "1px solid var(--chalk-ink)",
                borderRadius: "2px",
                padding: "1.5px 4px",
                textShadow:
                  "0 0 4px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.40)",
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
              fontSize: "10px",
              lineHeight: 1,
              textShadow:
                "0 0 4px rgba(0,0,0,0.60), 0 1px 2px rgba(0,0,0,0.45)",
            }}
          >
            {timestamp}
          </time>
        </div>

        <style>{`
          @keyframes tileEntry {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes tilePulse {
            0%, 100% { opacity: 0.35; }
            50%       { opacity: 0.65; }
          }
          @media (prefers-reduced-motion: reduce) {
            @keyframes tileEntry { from { opacity: 0; } to { opacity: 1; } }
            @keyframes tilePulse { 0%, 100% { opacity: 0.5; } }
          }
        `}</style>
      </button>

      <MealLightbox
        meal={{ ...meal, category: localCategory } as MealRow & { photos?: MealPhotoRow[] }}
        open={open}
        onClose={() => setOpen(false)}
        pending={pending}
      />
    </>
  );
}
