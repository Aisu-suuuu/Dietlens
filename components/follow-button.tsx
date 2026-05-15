"use client";

/**
 * FollowButton — toggle follow/unfollow on a target user.
 *
 * States:
 *   - "self": user is viewing their own profile — renders a chalked "you"
 *     label, not a button.
 *   - "anonymous": viewer hasn't upgraded to email yet — renders a CTA link
 *     to /profile prompting upgrade (you can't be the actor in a follow
 *     edge as a strictly anonymous user — there's nowhere meaningful for
 *     the followee to find your profile back).
 *   - "follow" / "following": the regular toggle.
 *
 * Optimistic: button flips immediately on click; the row insert/delete is
 * fire-and-await in the background. On failure we revert and toast.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAnonSession } from "@/lib/auth/anon-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { showToast } from "@/components/toast";

interface FollowButtonProps {
  /** The user whose profile is being viewed. */
  targetUserId: string;
  /** Optional initial state hint — saves one round-trip on first render. */
  initiallyFollowing?: boolean;
  /** Fires after every successful toggle so parent can re-fetch counts. */
  onChange?: (nowFollowing: boolean) => void;
}

export function FollowButton({
  targetUserId,
  initiallyFollowing,
  onChange,
}: FollowButtonProps) {
  const { userId, isAnonymous } = useAnonSession();
  const [following, setFollowing] = useState<boolean | null>(
    initiallyFollowing ?? null
  );
  const [inflight, setInflight] = useState(false);

  const isSelf = userId === targetUserId;

  // Resolve initial state if the parent didn't pass one.
  useEffect(() => {
    if (!userId || isSelf || initiallyFollowing !== undefined) return;
    let cancelled = false;

    (async () => {
      const supabase = getSupabaseBrowserClient();
      const { count, error } = await supabase
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_id", userId)
        .eq("followee_id", targetUserId);
      if (cancelled) return;
      if (error) {
        // Failed to read — leave state null so the button stays loading. The
        // toast on a subsequent toggle attempt will catch the underlying
        // problem.
        return;
      }
      setFollowing((count ?? 0) > 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, targetUserId, isSelf, initiallyFollowing]);

  async function toggle() {
    if (inflight || following === null || !userId) return;

    const nextState = !following;
    setInflight(true);
    setFollowing(nextState); // optimistic

    try {
      const supabase = getSupabaseBrowserClient();
      if (nextState) {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: userId, followee_id: targetUserId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", userId)
          .eq("followee_id", targetUserId);
        if (error) throw error;
      }
      onChange?.(nextState);
    } catch (err) {
      // Revert on failure.
      setFollowing(!nextState);
      console.error("[FollowButton] toggle failed:", err);
      const msg = err instanceof Error ? err.message : "Couldn't update";
      showToast({ message: msg, icon: "error" });
    } finally {
      setInflight(false);
    }
  }

  // ── Render variants ───────────────────────────────────────────────────────

  if (isSelf) {
    return (
      <span
        style={{
          color: "var(--fg-smoke)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
          fontSize: "11px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        you
      </span>
    );
  }

  if (isAnonymous) {
    return (
      <Link
        href="/profile"
        style={{
          ...buttonStyle("ghost"),
          textDecoration: "none",
        }}
      >
        Add email to follow
      </Link>
    );
  }

  if (following === null) {
    return (
      <button
        type="button"
        disabled
        style={{ ...buttonStyle("ghost"), opacity: 0.5 }}
      >
        …
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={inflight}
      aria-pressed={following}
      style={{
        ...buttonStyle(following ? "ghost" : "primary"),
        opacity: inflight ? 0.7 : 1,
        cursor: inflight ? "wait" : "pointer",
      }}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Button styles — kept local so this component owns its visual contract.
// ─────────────────────────────────────────────────────────────────────────────

function buttonStyle(variant: "primary" | "ghost"): React.CSSProperties {
  if (variant === "primary") {
    return {
      padding: "9px 18px",
      background: "var(--safelight, #E07B3A)",
      border: "none",
      borderRadius: "var(--radius-knob)",
      color: "var(--bg-cast-iron)",
      fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
      fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 600',
      fontSize: "13px",
      letterSpacing: "0.01em",
      WebkitTapHighlightColor: "transparent",
      transition: "opacity var(--dur-fast) var(--ease-out)",
    };
  }
  return {
    padding: "9px 18px",
    background: "transparent",
    border: "1px solid var(--border-crumb)",
    borderRadius: "var(--radius-knob)",
    color: "var(--fg-crema)",
    fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
    fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
    fontSize: "13px",
    letterSpacing: "0.01em",
    WebkitTapHighlightColor: "transparent",
    transition: "opacity var(--dur-fast) var(--ease-out)",
  };
}
