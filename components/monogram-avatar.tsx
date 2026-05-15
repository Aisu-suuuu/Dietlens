"use client";

/**
 * MonogramAvatar — deterministic SVG monogram in the darkroom palette.
 *
 * Inputs: a display_name (optional) + a stable seed (user id). When the
 * user has no display_name we render a single chalked dot instead of
 * fictional initials — the design value of "you're anonymous" comes from
 * showing absence, not making something up.
 *
 * The background hue is one of three tones from the design system —
 * cast-iron, ember, stove — picked by hashing the seed. The foreground
 * (crema text) is constant.
 */

import { useMemo } from "react";

interface MonogramAvatarProps {
  /** User id (or any stable string) used as the hash seed for the bg tone. */
  seed: string;
  /** Display name to derive initials from. Null/empty = anonymous dot. */
  displayName?: string | null;
  /** Render size in px. Default 56 (matches the design-system avatar slot). */
  size?: number;
}

const BACKGROUNDS = [
  "var(--bg-cast-iron)",
  "var(--bg-ember-black)",
  "var(--bg-stove-black)",
] as const;

function initialsFor(displayName: string): string {
  // Split on whitespace, take the first letter of the first two non-empty
  // words. Single-word names get only the first letter — that's intentional;
  // jamming letters in feels worse than letting the monogram breathe.
  const words = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) return "";
  return words.map((w) => w[0]!.toUpperCase()).join("");
}

function hashIndex(seed: string, modulo: number): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h) ^ seed.charCodeAt(i);
    h = h >>> 0;
  }
  return h % modulo;
}

export function MonogramAvatar({ seed, displayName, size = 56 }: MonogramAvatarProps) {
  const initials = useMemo(
    () => (displayName ? initialsFor(displayName) : ""),
    [displayName]
  );

  const bg = useMemo(() => BACKGROUNDS[hashIndex(seed, BACKGROUNDS.length)], [seed]);

  const halfSize = size / 2;
  const fontSize = Math.round(size * 0.4);

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-shutter)",
        background: bg,
        // Hairline warm-grain ring so the avatar reads as a tangible object
        // against the cast-iron page background.
        boxShadow:
          "inset 0 0 0 1px var(--border-crumb), 0 2px 6px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initials ? (
        <span
          style={{
            color: "var(--fg-crema)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
            fontSize: `${fontSize}px`,
            letterSpacing: "0.04em",
            lineHeight: 1,
          }}
        >
          {initials}
        </span>
      ) : (
        // Anonymous: chalked single dot at the centre.
        <span
          style={{
            width: Math.round(size * 0.16),
            height: Math.round(size * 0.16),
            borderRadius: "var(--radius-shutter)",
            background: "var(--chalk-ink)",
            opacity: 0.55,
            boxShadow: "0 0 6px rgba(232,199,154,0.35)",
            display: "block",
          }}
        />
      )}
    </div>
  );
}
