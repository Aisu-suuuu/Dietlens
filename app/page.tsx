"use client";

import { useEffect, useState } from "react";
import { useAnonSession } from "@/lib/auth/anon-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MealRow } from "@/lib/supabase/types";
import type { CaptureResult } from "@/lib/upload/capture";
import { MealCard } from "@/components/meal-card";
import { EmptyState } from "@/components/empty-state";

// ---------------------------------------------------------------------------
// TodayPage — the primary dashboard
//
// Renders a newest-first vertical feed of today's meals for the signed-in
// anonymous user. Today is filtered in the user's LOCAL timezone by building
// midnight-to-23:59:59.999 boundaries from `new Date()` (which always uses
// the browser's local tz when .setHours() is called without a UTC override).
// ---------------------------------------------------------------------------

export default function TodayPage() {
  const { session, loading: sessionLoading, error: sessionError } = useAnonSession();
  const [meals, setMeals] = useState<MealRow[] | null>(null);
  const [queryError, setQueryError] = useState<Error | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // ── Optimistic prepend on meal:created ────────────────────────────────────
  // Listen for the CustomEvent dispatched by <Fab /> after a successful upload.
  //
  // Strategy: window event (not Supabase Realtime).
  //   - Simpler for MVP — no realtime subscription to manage or teardown.
  //   - Instant: the event fires synchronously after the DB insert succeeds, so
  //     the UI updates on the same tick without a round-trip re-query.
  //   - Supabase Realtime is the better long-term solution (multi-tab, offline
  //     sync) but adds a websocket subscription, quota, and teardown complexity
  //     that isn't worth it for a single-user local-first MVP.
  useEffect(() => {
    function handleMealCreated(e: Event) {
      const detail = (e as CustomEvent<CaptureResult>).detail;
      if (!detail?.mealId) return;

      const newMeal: MealRow = {
        id: detail.mealId,
        user_id: session?.user?.id ?? "",
        image_path: detail.imagePath,
        category: detail.category,
        created_at: detail.createdAt,
      };

      // Prepend to the list — newest-first order matches the query sort.
      setMeals((prev) => (prev ? [newMeal, ...prev] : [newMeal]));
    }

    function handleMealDeleted(e: Event) {
      const { mealId } = (e as CustomEvent<{ mealId: string }>).detail;
      setMeals((prev) => (prev ? prev.filter((m) => m.id !== mealId) : prev));
    }

    function handleMealUpdated(e: Event) {
      const { mealId, updates } = (e as CustomEvent<{ mealId: string; updates: Partial<MealRow> }>).detail;
      setMeals((prev) => (prev ? prev.map((m) => (m.id === mealId ? { ...m, ...updates } : m)) : prev));
    }

    // ── meal:synced — swap an optimistic (offline) placeholder for the
    // server-authoritative row. The sync module fires this after a queued
    // meal has successfully been uploaded AND inserted.
    //
    // We update in place (no re-order) because the optimistic row was
    // prepended at offline-capture time; the user expects it to stay where
    // it is on the feed and just lose its "Queued" badge.
    function handleMealSynced(e: Event) {
      const detail = (e as CustomEvent<{
        localId: string;
        mealId: string;
        path: string;
        createdAt: string;
        category: MealRow["category"];
      }>).detail;
      if (!detail?.localId || !detail?.mealId) return;

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

    window.addEventListener("meal:created", handleMealCreated);
    window.addEventListener("meal:deleted", handleMealDeleted);
    window.addEventListener("meal:updated", handleMealUpdated);
    window.addEventListener("meal:synced", handleMealSynced);
    return () => {
      window.removeEventListener("meal:created", handleMealCreated);
      window.removeEventListener("meal:deleted", handleMealDeleted);
      window.removeEventListener("meal:updated", handleMealUpdated);
      window.removeEventListener("meal:synced", handleMealSynced);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;

    // ── Today filter in LOCAL timezone ───────────────────────────────────────
    // Both Date objects are created via new Date() then mutated with setHours().
    // setHours() operates in the local timezone, so this range is exactly
    // "today from midnight to 23:59:59.999 in whatever tz the user's device is in."
    // toISOString() converts to UTC for the Supabase query — correct behavior
    // because Supabase stores UTC timestamps and the >= / <= operators compare them.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const supabase = getSupabaseBrowserClient();

    supabase
      .from("meals")
      .select("*")
      .eq("user_id", session.user.id)
      .gte("created_at", startOfToday.toISOString())
      .lte("created_at", endOfToday.toISOString())
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          setQueryError(error as unknown as Error);
        } else {
          setMeals(data ?? []);
          setQueryError(null);
        }
      });
  }, [session, retryKey]);

  // ── Loading state ──────────────────────────────────────────────────────────
  // No spinner — "Developing…" in Fraunces with a chalk-dust pulse.
  if (sessionLoading || (session && meals === null && !queryError)) {
    return (
      <div
        style={{
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <PageHeader />
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
              fontFamily:
                "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings:
                "\"opsz\" 11, \"SOFT\" 100, \"wght\" 400",
              fontSize: "13px",
              animation: "chalkDustPulse 1.6s var(--ease-in-out) infinite",
            }}
          >
            Developing…
          </span>
          <style>{`
            @keyframes chalkDustPulse {
              0%, 100% { opacity: 0.30; }
              50%       { opacity: 0.65; }
            }
            @media (prefers-reduced-motion: reduce) {
              @keyframes chalkDustPulse {
                0%, 100% { opacity: 0.45; }
              }
            }
          `}</style>
        </div>
      </div>
    );
  }

  // ── Session error ─────────────────────────────────────────────────────────
  const activeError = sessionError ?? queryError;
  if (activeError) {
    return (
      <div
        style={{
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <PageHeader />
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
              fontFamily:
                "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings:
                "\"opsz\" 11, \"SOFT\" 100, \"wght\" 400",
              fontSize: "13px",
              lineHeight: 1.6,
              marginBottom: "var(--space-plate)",
            }}
          >
            {activeError.message}
          </p>
          <button
            type="button"
            onClick={() => setRetryKey((k) => k + 1)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "var(--fg-chalk-dust)",
              fontFamily:
                "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
              fontSize: "12px",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── No session yet (shouldn't normally reach here but defensive) ──────────
  if (!session) {
    return (
      <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <PageHeader />
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (meals !== null && meals.length === 0) {
    return (
      <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <PageHeader />
        <EmptyState />
      </div>
    );
  }

  // ── Meal feed ─────────────────────────────────────────────────────────────
  return (
    <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <PageHeader />

      {/* Contact-sheet feed — photos edge-to-edge, space-y-8 (32px) rhythm */}
      <ul
        role="list"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-shelf)",  // 32px between cards
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
// PageHeader — "Your Diet Today" in display Fraunces
// Generous safe-area-aware top padding.
// ---------------------------------------------------------------------------
function PageHeader() {
  return (
    <header
      style={{
        paddingLeft: "var(--space-counter)",
        paddingRight: "var(--space-counter)",
        paddingTop: "var(--space-room)",     // 40px — generous breathing room
        paddingBottom: "var(--space-shelf)", // 32px before feed
      }}
    >
      <h1
        style={{
          fontFamily:
            "var(--font-fraunces), ui-serif, Georgia, serif",
          // Display axis settings: opsz 144, SOFT 100, weight 500
          fontVariationSettings:
            "\"opsz\" 144, \"SOFT\" 100, \"wght\" 500",
          fontSize: "clamp(28px, 8vw, 40px)",
          letterSpacing: "var(--tracking-tight)",
          lineHeight: 1.1,
          color: "var(--fg-crema)",
          margin: 0,
        }}
      >
        Your Diet Today
      </h1>
    </header>
  );
}
