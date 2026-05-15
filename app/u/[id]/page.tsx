"use client";

/**
 * /u/[id] — public-ish user profile (Wave 3)
 *
 * Renders:
 *   - display_name (or chalked "Anonymous archive" when null)
 *   - follower / following counts
 *   - FollowButton (or "you" when viewing yourself)
 *   - The user's meals feed (newest-first)
 *
 * Visibility is enforced by RLS, NOT by this client.
 *   - If you're not the owner AND don't follow them, the meals query returns
 *     an empty array. We render a soft "Follow to see what they've been
 *     eating" empty state.
 *   - Counts come from a count-only query on `follows` which is gated by the
 *     follows_visible policy — you can see edges you're a party to, so the
 *     count fragments work for self + follower + followee cases.
 *
 * The id segment is validated as a UUID. Bad IDs route to notFound().
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, notFound } from "next/navigation";
import Link from "next/link";
import { useAnonSession } from "@/lib/auth/anon-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MealWithPhotos } from "@/lib/supabase/types";
import { MealCard } from "@/components/meal-card";
import { FollowButton } from "@/components/follow-button";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProfileData {
  displayName: string | null;
  followerCount: number;
  followingCount: number;
}

export default function PublicProfilePage() {
  const params = useParams();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  if (!UUID_RE.test(rawId)) {
    notFound();
  }
  const targetUserId = rawId.toLowerCase();

  const { session, loading: sessionLoading, userId } = useAnonSession();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [meals, setMeals] = useState<MealWithPhotos[] | null>(null);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [queryError, setQueryError] = useState<Error | null>(null);

  const isSelf = userId === targetUserId;

  // ── Fetch profile + counts + follow state ────────────────────────────────
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    (async () => {
      try {
        // Run in parallel — these don't depend on each other.
        const [
          profileRes,
          followerCountRes,
          followingCountRes,
          followingStateRes,
        ] = await Promise.all([
          supabase
            .from("profiles")
            .select("display_name")
            .eq("id", targetUserId)
            .maybeSingle(),
          supabase
            .from("follows")
            .select("*", { count: "exact", head: true })
            .eq("followee_id", targetUserId),
          supabase
            .from("follows")
            .select("*", { count: "exact", head: true })
            .eq("follower_id", targetUserId),
          isSelf
            ? Promise.resolve({ count: 0 })
            : supabase
                .from("follows")
                .select("*", { count: "exact", head: true })
                .eq("follower_id", userId!)
                .eq("followee_id", targetUserId),
        ]);

        if (cancelled) return;

        setProfile({
          displayName: profileRes.data?.display_name ?? null,
          followerCount: followerCountRes.count ?? 0,
          followingCount: followingCountRes.count ?? 0,
        });
        setFollowing(isSelf ? null : (followingStateRes.count ?? 0) > 0);
      } catch (err) {
        if (cancelled) return;
        setQueryError(err as Error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, targetUserId, userId, isSelf]);

  // ── Fetch meals (RLS gates visibility) ───────────────────────────────────
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    (async () => {
      try {
        const { data, error } = await supabase
          .from("meals")
          .select("*, photos:meal_photos(id, meal_id, image_path, position, created_at)")
          .eq("user_id", targetUserId)
          .order("created_at", { ascending: false });
        if (cancelled) return;
        if (error) {
          setQueryError(error as unknown as Error);
        } else {
          setMeals((data ?? []) as MealWithPhotos[]);
        }
      } catch (err) {
        if (cancelled) return;
        setQueryError(err as Error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, targetUserId, following]);
  // following is in deps so when the viewer follows/unfollows, the meals
  // refetch picks up the now-visible (or now-hidden) rows.

  const headline = useMemo(() => {
    if (profile?.displayName) return profile.displayName;
    return "Anonymous archive";
  }, [profile?.displayName]);

  // ── Loading + error states ───────────────────────────────────────────────
  if (sessionLoading || (!profile && !queryError)) {
    return (
      <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <BackLink />
        <div
          style={{
            paddingTop: "var(--space-kitchen)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <span style={chalkPulseTextStyle}>Developing…</span>
        </div>
        <style>{chalkPulseKeyframes}</style>
      </div>
    );
  }

  if (queryError) {
    return (
      <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <BackLink />
        <p
          style={{
            padding: "var(--space-shelf) var(--space-counter)",
            color: "var(--fg-smoke)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
            fontSize: "13px",
            lineHeight: 1.6,
          }}
        >
          {queryError.message}
        </p>
      </div>
    );
  }

  // ── Header + feed ────────────────────────────────────────────────────────
  return (
    <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <BackLink />
      <header
        style={{
          paddingLeft: "var(--space-counter)",
          paddingRight: "var(--space-counter)",
          paddingTop: "var(--space-room)",
          paddingBottom: "var(--space-shelf)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 144, "SOFT" 100, "wght" 500',
            fontSize: "clamp(26px, 7vw, 34px)",
            letterSpacing: "var(--tracking-tight)",
            lineHeight: 1.15,
            color: "var(--fg-crema)",
            margin: 0,
            wordBreak: "break-word",
          }}
        >
          {headline}
        </h1>

        {/* Counts row */}
        {profile && (
          <p
            style={{
              color: "var(--fg-smoke)",
              fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
              fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
              fontFeatureSettings: '"tnum"',
              fontSize: "12px",
              marginTop: "var(--space-crumb)",
              marginBottom: "var(--space-plate)",
              letterSpacing: "0.04em",
            }}
          >
            {profile.followerCount}{" "}
            {profile.followerCount === 1 ? "follower" : "followers"} ·{" "}
            {profile.followingCount} following
          </p>
        )}

        <FollowButton
          targetUserId={targetUserId}
          initiallyFollowing={following ?? undefined}
          onChange={(now) => {
            setFollowing(now);
            // Adjust follower count optimistically.
            setProfile((p) =>
              p
                ? { ...p, followerCount: Math.max(0, p.followerCount + (now ? 1 : -1)) }
                : p
            );
          }}
        />
      </header>

      {/* Meal feed — gated by RLS */}
      {meals && meals.length === 0 ? (
        <EmptyFeed isFollowing={following === true} isSelf={isSelf} />
      ) : (
        <ul
          role="list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-shelf)",
            paddingBottom: "var(--space-room)",
          }}
        >
          {(meals ?? []).map((meal) => (
            <li key={meal.id}>
              <MealCard meal={meal} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmptyFeed — context-aware copy depending on follow state.
// ─────────────────────────────────────────────────────────────────────────────

function EmptyFeed({ isFollowing, isSelf }: { isFollowing: boolean; isSelf: boolean }) {
  const copy = isSelf
    ? "You haven't logged any meals yet."
    : isFollowing
    ? "They haven't logged any meals yet."
    : "Follow to see what they've been eating.";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: "var(--space-kitchen) var(--space-counter)",
        textAlign: "center",
      }}
    >
      <p
        style={{
          color: "var(--fg-smoke)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 24, "SOFT" 100, "wght" 400',
          fontSize: "15px",
          lineHeight: 1.6,
          margin: 0,
          maxWidth: "320px",
          marginInline: "auto",
        }}
      >
        {copy}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BackLink — chalked "‹ Back" in the same shape as album detail's back link.
// ─────────────────────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <div
      style={{
        paddingLeft: "var(--space-counter)",
        paddingTop: "var(--space-shelf)",
      }}
    >
      <Link
        href="/profile"
        style={{
          color: "var(--fg-smoke)",
          fontFamily:
            "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
          fontSize: "12px",
          textDecoration: "none",
          letterSpacing: "0.04em",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 0",
          WebkitTapHighlightColor: "transparent",
        }}
        aria-label="Back to your profile"
      >
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
        Your profile
      </Link>
    </div>
  );
}

const chalkPulseTextStyle: React.CSSProperties = {
  color: "var(--fg-smoke)",
  fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
  fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
  fontSize: "13px",
  animation: "uChalkPulse 1.6s var(--ease-in-out) infinite",
};

const chalkPulseKeyframes = `
  @keyframes uChalkPulse {
    0%, 100% { opacity: 0.30; }
    50%       { opacity: 0.65; }
  }
`;
