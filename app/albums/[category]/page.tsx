"use client";

/**
 * AlbumDetailPage — /albums/[category]
 *
 * Approach: pure client component using useParams().
 * Rationale: anon auth is entirely client-side (useAnonSession), so a server
 * wrapper would only await params and immediately hand off to a client child.
 * The one-component approach avoids that indirection with no tradeoffs for MVP.
 *
 * Category validation:
 * - decodeURIComponent the param (AlbumTile uses encodeURIComponent on the href).
 * - Case-insensitive match against CATEGORIES to produce the canonical casing.
 * - If no match, renders notFound() via a client-side throw (Next 16 supports
 *   notFound() in client components — it throws a special error that triggers the
 *   nearest not-found boundary / 404 page).
 */

import { useEffect, useRef, useState } from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { useAnonSession } from "@/lib/auth/anon-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CATEGORIES, type Category } from "@/lib/supabase/types";
import type { MealRow } from "@/lib/supabase/types";
import type { CaptureResult } from "@/lib/upload/capture";
import { MealCard } from "@/components/meal-card";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the canonical Category if the raw param matches, else null. */
function resolveCategory(raw: string): Category | null {
  const decoded = decodeURIComponent(raw);
  // Case-insensitive match — guards against e.g. "lunch" or "LUNCH"
  const match = CATEGORIES.find(
    (c) => c.toLowerCase() === decoded.toLowerCase()
  );
  return match ?? null;
}

/** Pluralise "meal" / "meals" */
function mealCount(n: number): string {
  return `${n} ${n === 1 ? "meal" : "meals"}`;
}

// ---------------------------------------------------------------------------
// Category-specific empty state copy
// ---------------------------------------------------------------------------
const EMPTY_COPY: Record<Category, string> = {
  Breakfast:      "No Breakfast logged yet. Start your morning here.",
  "Post-Workout": "No Post-Workout meals logged yet. Fuel recovery — add one.",
  "Mid-Morning":  "No Mid-Morning snacks logged yet. That gap is still open.",
  Lunch:          "No Lunch logged yet. Midday awaits.",
  Snack:          "No Snacks logged yet. Even the small bites count.",
  Dinner:         "No Dinner logged yet. End the day with something good.",
};

// ---------------------------------------------------------------------------
// CategoryEmptyState — inline, category-specific
// ---------------------------------------------------------------------------
function CategoryEmptyState({ category }: { category: Category }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "var(--space-kitchen)",
        paddingBottom: "var(--space-kitchen)",
        paddingLeft: "var(--space-counter)",
        paddingRight: "var(--space-counter)",
        textAlign: "center",
      }}
    >
      {/* Faint bowl + magnifier glyph — same as EmptyState but smaller */}
      <svg
        width="80"
        height="80"
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
        focusable="false"
        style={{
          marginBottom: "var(--space-shelf)",
          opacity: 0.12,
          animation: "albumEmptyPulse 3.2s var(--ease-in-out) infinite",
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
        <path
          d="M26 50 Q35 46 44 50 Q53 54 62 50"
          stroke="var(--fg-crema)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          opacity="0.7"
        />
        {/* Magnifier */}
        <circle
          cx="62"
          cy="30"
          r="14"
          stroke="var(--fg-crema)"
          strokeWidth="1.5"
          fill="none"
        />
        <line
          x1="72"
          y1="40"
          x2="82"
          y2="52"
          stroke="var(--fg-crema)"
          strokeWidth="2"
          strokeLinecap="round"
        />
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

      <p
        style={{
          color: "var(--fg-smoke)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 24, "SOFT" 100, "wght" 400',
          fontSize: "15px",
          lineHeight: 1.6,
          maxWidth: "240px",
          margin: 0,
        }}
      >
        {EMPTY_COPY[category]}
      </p>

      <style>{`
        @keyframes albumEmptyPulse {
          0%, 100% { opacity: 0.09; }
          50%       { opacity: 0.16; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes albumEmptyPulse {
            0%, 100% { opacity: 0.12; }
          }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlbumDetailPage
// ---------------------------------------------------------------------------
export default function AlbumDetailPage() {
  const params = useParams();

  // params.category could be string | string[] in the App Router type
  const rawCategory = Array.isArray(params.category)
    ? params.category[0]
    : (params.category ?? "");

  const category = resolveCategory(rawCategory);

  // Validate now — if invalid, call notFound() before any hooks run.
  // notFound() throws, so hooks below are only reached for valid categories.
  if (!category) {
    notFound();
  }

  const { session, loading: sessionLoading, error: sessionError } = useAnonSession();
  const [meals, setMeals] = useState<MealRow[] | null>(null);
  const [queryError, setQueryError] = useState<Error | null>(null);

  // Stable ref: needed so the event listener always sees current session
  // without the event listener effect re-running on each session update.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // ── Fetch all-time meals for this category ────────────────────────────────
  useEffect(() => {
    if (!session) return;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setMeals((prev) => prev ?? []);
      setQueryError(null);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("meals")
          .select("*")
          .eq("user_id", session.user.id)
          .eq("category", category)
          .order("created_at", { ascending: false });
        if (cancelled) return;
        if (error) {
          setQueryError(error as unknown as Error);
        } else {
          setMeals(data ?? []);
          setQueryError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof TypeError && err.message.includes("fetch")) {
          setMeals((prev) => prev ?? []);
          setQueryError(null);
        } else {
          setQueryError(err as Error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, category]);

  // ── meal:created — optimistically prepend if category matches ────────────
  useEffect(() => {
    function handleMealCreated(e: Event) {
      const detail = (e as CustomEvent<CaptureResult>).detail;
      if (!detail?.mealId) return;
      // Only prepend if the new meal belongs to this album
      if (detail.category !== category) return;

      const newMeal: MealRow = {
        id: detail.mealId,
        user_id: sessionRef.current?.user?.id ?? "",
        image_path: detail.imagePath,
        category: detail.category,
        created_at: detail.createdAt,
      };

      setMeals((prev) => (prev ? [newMeal, ...prev] : [newMeal]));
    }

    window.addEventListener("meal:created", handleMealCreated);
    return () => window.removeEventListener("meal:created", handleMealCreated);
  }, [category]);

  // ── meal:deleted — stub for Wave 3 (T14) ─────────────────────────────────
  useEffect(() => {
    function handleMealDeleted(e: Event) {
      // T14 (Wave 3) will fire this event with { mealId: string }.
      // The handler below is ready to accept it when that task ships.
      const detail = (e as CustomEvent<{ mealId: string }>).detail;
      if (!detail?.mealId) return;

      // Debug log so Wave 3 dev can verify the event arrives here
      console.debug("[AlbumDetailPage] meal:deleted received", detail.mealId);

      // Remove the deleted meal from the feed
      setMeals((prev) =>
        prev ? prev.filter((m) => m.id !== detail.mealId) : prev
      );
    }

    function handleMealUpdated(e: Event) {
      const { mealId, updates } = (e as CustomEvent<{ mealId: string; updates: Partial<MealRow> }>).detail;
      if (!mealId || !updates) return;

      // If the meal moved OUT of this album's category, remove it.
      // (Re-categorizing INTO this album from elsewhere requires a full MealRow
      // we don't have on the event — a natural fix is to re-fetch next visit.
      // Acceptable for MVP: the user just moved a card away and likely returns
      // to Albums → taps the destination category to confirm.)
      if (updates.category && updates.category !== category) {
        setMeals((prev) => (prev ? prev.filter((m) => m.id !== mealId) : prev));
      }
    }

    // ── meal:synced — swap optimistic (offline) placeholder for server row.
    // Fires when a queued meal lands in the DB. Same category-fence as the
    // meal:created handler: we only care about meals that belong here. If
    // sync somehow assigned a different category (shouldn't — the queue
    // carries the original category verbatim), treat it as a move-out and
    // drop the card.
    function handleMealSynced(e: Event) {
      const detail = (e as CustomEvent<{
        localId: string;
        mealId: string;
        path: string;
        createdAt: string;
        category: Category;
      }>).detail;
      if (!detail?.localId || !detail?.mealId) return;

      if (detail.category !== category) {
        setMeals((prev) =>
          prev ? prev.filter((m) => m.id !== detail.localId) : prev
        );
        return;
      }

      setMeals((prev) => {
        if (!prev) return prev;
        return prev.map((m) =>
          m.id === detail.localId
            ? {
                ...m,
                id: detail.mealId,
                image_path: detail.path,
                category: detail.category,
                created_at: detail.createdAt,
              }
            : m
        );
      });
    }

    window.addEventListener("meal:deleted", handleMealDeleted);
    window.addEventListener("meal:updated", handleMealUpdated);
    window.addEventListener("meal:synced", handleMealSynced);
    return () => {
      window.removeEventListener("meal:deleted", handleMealDeleted);
      window.removeEventListener("meal:updated", handleMealUpdated);
      window.removeEventListener("meal:synced", handleMealSynced);
    };
  }, [category]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (sessionLoading || (session && meals === null && !queryError)) {
    return (
      <div>
        <PageHeader category={category} mealCount={null} />
        <div
          style={{
            paddingTop: "var(--space-kitchen)",
            paddingBottom: "var(--space-kitchen)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              color: "var(--fg-smoke)",
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
              fontSize: "13px",
              animation: "albumChalkPulse 1.6s var(--ease-in-out) infinite",
            }}
          >
            Developing…
          </span>
          <style>{`
            @keyframes albumChalkPulse {
              0%, 100% { opacity: 0.30; }
              50%       { opacity: 0.65; }
            }
            @media (prefers-reduced-motion: reduce) {
              @keyframes albumChalkPulse {
                0%, 100% { opacity: 0.45; }
              }
            }
          `}</style>
        </div>
      </div>
    );
  }

  // ── Session or query error ────────────────────────────────────────────────
  const activeError = sessionError ?? queryError;
  if (activeError) {
    return (
      <div>
        <PageHeader category={category} mealCount={null} />
        <div
          style={{
            paddingLeft: "var(--space-counter)",
            paddingRight: "var(--space-counter)",
            paddingTop: "var(--space-shelf)",
          }}
        >
          <p
            style={{
              color: "var(--fg-smoke)",
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
              fontSize: "13px",
              lineHeight: 1.6,
            }}
          >
            {activeError.message}
          </p>
        </div>
      </div>
    );
  }

  // ── No session (defensive — shouldn't reach here normally) ───────────────
  if (!session) {
    return <PageHeader category={category} mealCount={null} />;
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (meals !== null && meals.length === 0) {
    return (
      <div>
        <PageHeader category={category} mealCount={0} />
        <CategoryEmptyState category={category} />
      </div>
    );
  }

  // ── Meal feed ─────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader category={category} mealCount={meals?.length ?? null} />

      {/* Vertical newest-first feed — same rhythm as the Today dashboard */}
      <ul
        role="list"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-shelf)",   // 32px — same card-gap as dashboard
          paddingBottom: "var(--space-room)",  // 40px breathing room above nav
        }}
      >
        {meals!.map((meal) => (
          <li key={meal.id}>
            <MealCard meal={meal} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageHeader — category title + meal count + back link
// ---------------------------------------------------------------------------
interface PageHeaderProps {
  category: Category;
  /** null while loading; number once resolved */
  mealCount: number | null;
}

function PageHeader({ category, mealCount: count }: PageHeaderProps) {
  return (
    <header
      style={{
        paddingLeft: "var(--space-counter)",
        paddingRight: "var(--space-counter)",
        paddingTop: "var(--space-room)",     // 40px — generous breathing room
        paddingBottom: "var(--space-shelf)", // 32px before feed
      }}
    >
      {/* Back link — muted, feels like an archivist returning the folder */}
      <div
        style={{
          marginBottom: "var(--space-bite)",  // 8px above title
        }}
      >
        <Link
          href="/albums"
          style={{
            color: "var(--fg-smoke)",
            fontFamily: "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
            fontSize: "12px",
            textDecoration: "none",
            letterSpacing: "0.04em",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            // Minimum 44px hit target — satisfied by inline padding + safe-area
            padding: "4px 0",
            WebkitTapHighlightColor: "transparent",
          }}
          aria-label="Back to Albums"
        >
          {/* Left chevron — matches the darkroom aesthetic (hairline, not bold) */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            focusable="false"
            style={{ flexShrink: 0 }}
          >
            <path
              d="M7.5 2 L3.5 6 L7.5 10"
              stroke="var(--fg-smoke)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Albums
        </Link>
      </div>

      {/* Thin warm-grain rule above the title — same as Albums page */}
      <div
        aria-hidden="true"
        style={{
          height: "1px",
          background: "var(--border-crumb)",
          marginBottom: "var(--space-bite)",
          width: "40px",
        }}
      />

      {/* Category name — display Fraunces, same size as Albums h1 */}
      <h1
        style={{
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 144, "SOFT" 100, "wght" 500',
          fontSize: "clamp(28px, 8vw, 36px)",
          letterSpacing: "var(--tracking-tight)",
          lineHeight: 1.1,
          color: "var(--fg-crema)",
          margin: 0,
        }}
      >
        {category}
      </h1>

      {/* Meal count sub-line — chalked tally beneath the title */}
      {count !== null && (
        <p
          style={{
            color: "var(--fg-smoke)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
            fontFeatureSettings: '"tnum"',
            fontSize: "12px",
            marginTop: "var(--space-crumb)",  // 4px below title
            marginBottom: 0,
            letterSpacing: "0.04em",
          }}
        >
          {mealCount(count)}
        </p>
      )}
    </header>
  );
}
