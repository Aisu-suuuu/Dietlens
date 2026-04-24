"use client";

/**
 * EmptyState — shown when no meals are logged for today.
 *
 * Darkroom aesthetic: muted text on cast-iron canvas.
 * A faint bowl+magnifier outline sits behind the copy —
 * rendered as SVG paths using only token colors.
 *
 * Copy (verbatim per PRD): "No meals logged today. Tap + to start."
 */
export function EmptyState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "var(--space-kitchen)",    // 56px top air
        paddingBottom: "var(--space-kitchen)", // 56px bottom air
        paddingLeft: "var(--space-counter)",   // 24px sides
        paddingRight: "var(--space-counter)",
        textAlign: "center",
        position: "relative",
      }}
    >
      {/* ── Faint brand icon (bowl + magnifier outline) ──────────
          Evokes the DietLens concept without heavy illustration.
          Color: --fg-smoke at very low opacity (barely there).
          Scales with viewport; not interactive.
      ──────────────────────────────────────────────────────── */}
      <svg
        width="96"
        height="96"
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
        focusable="false"
        style={{
          marginBottom: "var(--space-shelf)",  // 32px gap to text
          opacity: 0.12,
          // Subtle pulse — like a photo developing in the dark
          animation: "emptyPulse 3.2s var(--ease-in-out) infinite",
        }}
      >
        {/* Bowl silhouette */}
        <ellipse
          cx="44"
          cy="52"
          rx="28"
          ry="10"
          stroke="var(--fg-crema)"
          strokeWidth="1.5"
        />
        <path
          d="M16 44 Q16 68 44 68 Q72 68 72 44"
          stroke="var(--fg-crema)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        {/* Bowl contents — three gentle wavy lines */}
        <path
          d="M26 50 Q35 46 44 50 Q53 54 62 50"
          stroke="var(--fg-crema)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          opacity="0.7"
        />
        {/* Magnifier lens */}
        <circle
          cx="62"
          cy="30"
          r="14"
          stroke="var(--fg-crema)"
          strokeWidth="1.5"
          fill="none"
        />
        {/* Magnifier handle */}
        <line
          x1="72"
          y1="40"
          x2="82"
          y2="52"
          stroke="var(--fg-crema)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Lens glint */}
        <circle
          cx="57"
          cy="25"
          r="3"
          stroke="var(--fg-crema)"
          strokeWidth="1"
          fill="none"
          opacity="0.5"
        />
      </svg>

      {/* ── Copy ──────────────────────────────────────────────── */}
      <p
        style={{
          color: "var(--fg-smoke)",          // muted, as per spec
          fontFamily:
            "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings:
            "\"opsz\" 24, \"SOFT\" 100, \"wght\" 400",
          fontSize: "16px",
          lineHeight: 1.5,
          maxWidth: "220px",
          // Verbatim PRD copy — do not modify
          margin: 0,
        }}
      >
        No meals logged today.
        <br />
        Tap + to start.
      </p>

      <style>{`
        @keyframes emptyPulse {
          0%, 100% { opacity: 0.10; }
          50%       { opacity: 0.16; }
        }

        @media (prefers-reduced-motion: reduce) {
          @keyframes emptyPulse {
            0%, 100% { opacity: 0.12; }
          }
        }
      `}</style>
    </div>
  );
}
