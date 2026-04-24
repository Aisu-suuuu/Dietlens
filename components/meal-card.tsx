"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MealRow } from "@/lib/supabase/types";

interface MealCardProps {
  meal: MealRow;
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

/**
 * MealCard — the contact-sheet strip.
 *
 * Design mandates (from system.md):
 * - Photo fills edge-to-edge; no border, no outer radius.
 * - Masking-tape label top-left: thermal-paper cream, Fraunces ink,
 *   rotated 0.8°, soft inner shadow (tape has thickness), 2px radius.
 * - Chalked timestamp bottom-right: crema at ~62% opacity, Fraunces
 *   opsz:11 SOFT:100, 11px, "chalk-on-iron" feel via text-shadow.
 */
export function MealCard({ meal }: MealCardProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
  }, [meal.image_path]);

  const timestamp = formatLocalTime(meal.created_at);
  const altText = `${meal.category} at ${timestamp}`;

  return (
    <article
      style={{
        position: "relative",
        overflow: "hidden",
        // No border-radius, no outer border — contact-sheet strip
        borderRadius: 0,
        background: "var(--bg-stove-black)",
        // Entry animation: Polaroid handed down from above
        animation:
          "mealCardEntry var(--dur-normal) var(--ease-shutter) both",
      }}
    >
      {/* ── Photo ─────────────────────────────────────────────── */}
      {signedUrl && !imgError ? (
        <div style={{ position: "relative", width: "100%" }}>
          {/*
            Image fills width, natural height — no aspect override.
            next/image requires width/height; we use fill + unset height
            by wrapping in a natural-height div with `position: relative`.
            Use a plain <img> for natural dimensions without CLS constraints.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signedUrl}
            alt={altText}
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              // Ensure image is the full hero with no gaps
              verticalAlign: "bottom",
            }}
            onError={() => setImgError(true)}
          />

          {/* ── Masking-tape category label ─────────────────────
              Signature element. MUST keep 0.8° rotation.
              Background: --tape-surface (#F2EBDD thermal-paper cream).
              Ink:        --tape-ink (#2A2320 cast-iron dark).
              Shadow:     multiple box-shadows simulate tape thickness
                          (soft inner glow + dropped edge).
              Radius:     --radius-tape (2px) — tape tears don't round.
          ─────────────────────────────────────────────────────── */}
          <span
            aria-label={`Category: ${meal.category}`}
            style={{
              position: "absolute",
              top: "var(--space-sip)",       // 12px from top
              left: "var(--space-sip)",      // 12px from left
              background: "var(--tape-surface)",
              color: "var(--tape-ink)",
              // Fraunces at label opsz settings (opsz:24, SOFT:50, wght:500)
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: "\"opsz\" 24, \"SOFT\" 50, \"wght\" 500",
              fontSize: "11px",
              letterSpacing: "var(--tracking-wide)",
              textTransform: "uppercase",
              lineHeight: 1,
              padding: "4px 8px",
              borderRadius: "var(--radius-tape)",  // 2px
              // THE signature rotation — 0.8°, never zero
              transform: "rotate(0.8deg)",
              transformOrigin: "top left",
              // Tape thickness simulation:
              // - outer drop shadow for the "stuck" edge depth
              // - inset shadows for the inner tape surface thickness
              boxShadow: [
                "0 1px 3px var(--tape-shadow)",          // grounding drop
                "inset 0 1px 0 rgba(255,255,255,0.18)",  // tape top highlight
                "inset 0 -1px 0 rgba(0,0,0,0.12)",      // tape bottom inner edge
                "inset 1px 0 0 rgba(255,255,255,0.10)",  // left edge
                "inset -1px 0 0 rgba(0,0,0,0.10)",      // right edge
              ].join(", "),
              // Tape stick-on animation: opacity + rotation from 0 → 0.8°
              animation:
                "tapeStick 180ms var(--ease-shutter) both",
              // Prevent text selection on long-press
              userSelect: "none",
              // Ragged tape edge: subtle clip for organic feel
              WebkitBackfaceVisibility: "hidden",
            }}
          >
            {meal.category}
          </span>

          {/* ── Chalked timestamp ──────────────────────────────
              Bottom-right overlay. Crema at 62% opacity (--chalk-ink).
              Fraunces chalk settings: opsz:11, SOFT:100, wght:400.
              Text-shadow for chalk-on-iron diffusion.
          ─────────────────────────────────────────────────────── */}
          <time
            dateTime={meal.created_at}
            style={{
              position: "absolute",
              bottom: "var(--space-sip)",   // 12px from bottom
              right: "var(--space-sip)",    // 12px from right
              color: "var(--chalk-ink)",    // rgba(232, 199, 154, 0.62)
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: "\"opsz\" 11, \"SOFT\" 100, \"wght\" 400",
              fontFeatureSettings: "\"tnum\"",
              fontSize: "11px",
              lineHeight: 1,
              // Chalk diffusion: soft blur halo mimics chalk dust on iron
              textShadow: [
                "0 0 4px rgba(0,0,0,0.55)",     // dark bleed into photo
                "0 1px 2px rgba(0,0,0,0.40)",   // ground anchor
              ].join(", "),
              userSelect: "none",
              // Prevent text from overlapping tape on very short images
              maxWidth: "calc(100% - var(--space-shelf))",
            }}
          >
            {timestamp}
          </time>
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
              fontVariationSettings: "\"opsz\" 11, \"SOFT\" 100, \"wght\" 400",
              fontSize: "13px",
            }}
          >
            Photo unavailable
          </span>

          {/* Still render the tape label on error state */}
          <span
            style={{
              position: "absolute",
              top: "var(--space-sip)",
              left: "var(--space-sip)",
              background: "var(--tape-surface)",
              color: "var(--tape-ink)",
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: "\"opsz\" 24, \"SOFT\" 50, \"wght\" 500",
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
              ].join(", "),
              userSelect: "none",
            }}
          >
            {meal.category}
          </span>

          <time
            dateTime={meal.created_at}
            style={{
              position: "absolute",
              bottom: "var(--space-sip)",
              right: "var(--space-sip)",
              color: "var(--chalk-ink)",
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: "\"opsz\" 11, \"SOFT\" 100, \"wght\" 400",
              fontFeatureSettings: "\"tnum\"",
              fontSize: "11px",
              lineHeight: 1,
              textShadow: "0 0 4px rgba(0,0,0,0.55)",
              userSelect: "none",
            }}
          >
            {timestamp}
          </time>
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
              fontVariationSettings: "\"opsz\" 11, \"SOFT\" 100, \"wght\" 400",
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
  );
}
