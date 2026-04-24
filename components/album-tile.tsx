"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Category } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Deterministic per-category rotation (-1.2° to +1.2°)
// ---------------------------------------------------------------------------
// djb2-style hash: iterate char codes, XOR + multiply.
// Produces a stable integer in [0, 65535]; map to [-1.2, +1.2].
function categoryRotation(cat: string): number {
  let h = 5381;
  for (let i = 0; i < cat.length; i++) {
    h = ((h << 5) + h) ^ cat.charCodeAt(i);
    h = h >>> 0; // coerce to Uint32
  }
  // Map [0, 0xFFFFFFFF] → [-1.2, +1.2]
  const norm = h / 0xffffffff; // [0, 1]
  return -1.2 + norm * 2.4;
}

// Tape-label tilt also varies slightly per category (+/- 0.4° from base 0.8°)
// so the grid doesn't feel robotic — same hash, different seed.
function tapeTilt(cat: string): number {
  let h = 1009;
  for (let i = 0; i < cat.length; i++) {
    h = ((h * 31) + cat.charCodeAt(i)) >>> 0;
  }
  const norm = h / 0xffffffff;
  return 0.4 + norm * 0.8; // [0.4°, 1.2°]
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface AlbumTileProps {
  category: Category;
  count: number;
  latestImagePath: string | null;
}

// ---------------------------------------------------------------------------
// AlbumTile
// ---------------------------------------------------------------------------
export function AlbumTile({ category, count, latestImagePath }: AlbumTileProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  // Fetch signed URL once we have a path
  useEffect(() => {
    if (!latestImagePath) return;
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    supabase.storage
      .from("meal-photos")
      .createSignedUrl(latestImagePath, 3600)
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
  }, [latestImagePath]);

  const rotation = categoryRotation(category);
  const tilt = tapeTilt(category);
  const hasPhoto = !!latestImagePath && !imgError;
  const isLoading = !!latestImagePath && !imgError && !signedUrl;

  return (
    /*
      The <Link> is the tap target — full tile is clickable.
      transform is applied to the inner wrapper, NOT the Link,
      so the hit zone stays axis-aligned even though the visual tilts.
    */
    <Link
      href={`/albums/${encodeURIComponent(category)}`}
      aria-label={`${category} — ${count} ${count === 1 ? "meal" : "meals"}`}
      style={{
        display: "block",
        // Slightly generous hit area — 44px minimum satisfied by tile height
        textDecoration: "none",
        WebkitTapHighlightColor: "transparent",
        // Center the rotated inner tile without shifting layout
        perspective: "600px",
      }}
    >
      {/* Inner wrapper — the visual tile that rotates */}
      <div
        style={{
          transform: `rotate(${rotation.toFixed(3)}deg)`,
          transformOrigin: "center center",
          transition: `transform var(--dur-fast) var(--ease-out),
                       box-shadow var(--dur-fast) var(--ease-out)`,
          // ── Polaroid portrait shape: 4:5 aspect ratio ──
          aspectRatio: "4 / 5",
          borderRadius: "var(--radius-polaroid)",
          overflow: "hidden",
          position: "relative",
          // Surface tint at elevation-1
          background: "var(--bg-stove-black)",
          // Warm-grain border, slightly more visible than subtle
          boxShadow: [
            "0 2px 8px rgba(0,0,0,0.55)",       // grounding shadow
            "0 0 0 1px var(--border-crumb)",     // warm-grain outline
          ].join(", "),
          cursor: "pointer",
        }}
        className="album-tile-inner"
      >
        {/* ── Photo / placeholder fill ────────────────────────── */}
        {hasPhoto && signedUrl ? (
          /* ── Has image: photo fills the tile ── */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signedUrl}
            alt={`Most recent ${category} meal`}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              verticalAlign: "bottom",
            }}
            onError={() => setImgError(true)}
          />
        ) : isLoading ? (
          /* ── Loading skeleton: "film developing" pulse ── */
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "var(--bg-ember-black)",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "flex-end",
              padding: "var(--space-sip)",
            }}
          >
            <span
              style={{
                color: "var(--fg-smoke)",
                fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
                fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
                fontSize: "10px",
                lineHeight: 1,
                animation: "chalkPulse 1.6s var(--ease-in-out) infinite",
                userSelect: "none",
              }}
            >
              developing…
            </span>
          </div>
        ) : (
          /* ── Zero meals / image error: dashed placeholder ── */
          <div
            aria-label={`No meals in ${category} yet`}
            style={{
              width: "100%",
              height: "100%",
              background: "var(--bg-cast-iron)",
              // Dashed warm-grain border inset into the tile
              boxShadow: "inset 0 0 0 1.5px var(--border-subtle)",
              backgroundImage: [
                // Subtle cross-hatch grain — faint crema dots on the dark canvas
                // to evoke unexposed photo paper, not a blank div
                "repeating-linear-gradient(" +
                  "45deg," +
                  "transparent," +
                  "transparent 6px," +
                  "rgba(232,199,154,0.025) 6px," +
                  "rgba(232,199,154,0.025) 7px" +
                ")",
              ].join(","),
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
            }}
          >
            {/* Faint film-frame corner marks — darkroom placeholder motif */}
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              aria-hidden="true"
              style={{ opacity: 0.18 }}
            >
              {/* Top-left corner bracket */}
              <path
                d="M8 20 L8 8 L20 8"
                stroke="var(--fg-crema)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              {/* Top-right corner bracket */}
              <path
                d="M28 8 L40 8 L40 20"
                stroke="var(--fg-crema)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              {/* Bottom-right corner bracket */}
              <path
                d="M40 28 L40 40 L28 40"
                stroke="var(--fg-crema)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              {/* Bottom-left corner bracket */}
              <path
                d="M20 40 L8 40 L8 28"
                stroke="var(--fg-crema)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              {/* Center crosshair — empty film frame marker */}
              <line
                x1="24" y1="20"
                x2="24" y2="28"
                stroke="var(--fg-crema)"
                strokeWidth="1"
                strokeLinecap="round"
              />
              <line
                x1="20" y1="24"
                x2="28" y2="24"
                stroke="var(--fg-crema)"
                strokeWidth="1"
                strokeLinecap="round"
              />
            </svg>
          </div>
        )}

        {/* ── Masking-tape category label ─────────────────────────
            Signature element. Consistent with MealCard treatment:
            thermal-paper cream bg, tape-ink text, Fraunces, 2px radius.
            Tilt varies per category (tapeTilt) so the grid feels
            hand-placed, not templated.
        ──────────────────────────────────────────────────────────── */}
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
            fontSize: "10px",
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            lineHeight: 1,
            padding: "3px 7px",
            borderRadius: "var(--radius-tape)",
            transform: `rotate(${tilt.toFixed(2)}deg)`,
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
            whiteSpace: "nowrap",
            // Keep label readable on both photo and placeholder bg
            zIndex: 2,
          }}
        >
          {category}
        </span>

        {/* ── Chalked count — bottom-right tally ─────────────────
            Chalk aesthetic: Fraunces chalk settings, --chalk-ink color.
            Tabular numerals for alignment.
            Zero-meal state: "—" so the slot is acknowledged but not
            misleading; count > 0 shows the tally number.
        ──────────────────────────────────────────────────────────── */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "var(--space-sip)",
            right: "var(--space-sip)",
            color: "var(--chalk-ink)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
            fontFeatureSettings: '"tnum"',
            fontSize: "13px",
            lineHeight: 1,
            textShadow: [
              "0 0 6px rgba(0,0,0,0.70)",
              "0 1px 2px rgba(0,0,0,0.55)",
            ].join(", "),
            userSelect: "none",
            zIndex: 2,
          }}
        >
          {count > 0 ? count : "—"}
        </span>
      </div>

      {/*
        Hover / active state keyframes + tile-entry animation.
        Scoped to class .album-tile-inner — no global pollution.
      */}
      <style>{`
        @keyframes tapeStick {
          from {
            opacity: 0;
            transform: rotate(0deg) scale(0.96);
          }
          to {
            opacity: 1;
            transform: rotate(var(--_tilt, 0.8deg)) scale(1);
          }
        }

        @keyframes chalkPulse {
          0%, 100% { opacity: 0.35; }
          50%       { opacity: 0.65; }
        }

        @keyframes tileEntry {
          from {
            opacity: 0;
            transform: translateY(6px) rotate(var(--_rot, 0deg));
          }
          to {
            opacity: 1;
            transform: translateY(0) rotate(var(--_rot, 0deg));
          }
        }

        .album-tile-inner {
          animation: tileEntry var(--dur-normal) var(--ease-shutter) both;
        }

        /* Lift on hover/focus: slight scale + stronger shadow */
        a:hover .album-tile-inner,
        a:focus-visible .album-tile-inner {
          box-shadow:
            0 6px 20px rgba(0,0,0,0.70),
            0 0 0 1.5px var(--border-ember);
        }

        /* Active / press: settle back down like picking up a card */
        a:active .album-tile-inner {
          box-shadow:
            0 1px 4px rgba(0,0,0,0.55),
            0 0 0 1px var(--border-crumb);
        }

        @media (prefers-reduced-motion: reduce) {
          @keyframes tapeStick {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes tileEntry {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          @keyframes chalkPulse {
            0%, 100% { opacity: 0.5; }
          }
          .album-tile-inner {
            transition: none;
          }
        }
      `}</style>
    </Link>
  );
}
