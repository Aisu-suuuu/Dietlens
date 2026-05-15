"use client";

/**
 * /profile — DietLens profile (Wave 2: email upgrade)
 *
 * Three states:
 *   1. Loading — chalk-dust "Developing…" pulse (mirrors Today/Albums).
 *   2. Anonymous (default) — "You're using DietLens anonymously" hero + an
 *      email input that triggers supabase.auth.updateUser({ email }). The
 *      anon UUID is preserved on confirmation, so existing meals carry over.
 *   3. Email-confirmed — Email shown chalked. Display name editable inline
 *      (saved to public.profiles on blur). Sign-out at the bottom.
 *
 * Note: anonymous users do NOT see sign-out — signing out of an anon
 * session would orphan their meals (the session token is the only way back
 * to them on this device). Once a user has an email, sign-out is safe.
 *
 * Wave 3 will extend this with Following / Followers lists.
 * Wave 4 will add an Invite-a-friend form.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAnonSession } from "@/lib/auth/anon-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { showToast } from "@/components/toast";
import { MonogramAvatar } from "@/components/monogram-avatar";

/**
 * Tiny inner component whose only job is to read ?auth_error= from the URL
 * and surface a toast. Wrapped in <Suspense> below so the rest of the page
 * can prerender statically (Next 16 requires a Suspense boundary around any
 * useSearchParams() consumer).
 */
function AuthErrorBanner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const authError = searchParams?.get("auth_error");
    if (!authError) return;
    showToast({
      message: `Sign-in error: ${authError === "missing_token" ? "link expired or invalid" : authError}`,
      icon: "error",
      duration: 4000,
    });
    // Clean the URL so a refresh doesn't re-fire the toast.
    router.replace("/profile");
  }, [searchParams, router]);

  return null;
}

export default function ProfilePage() {
  const { session, loading, error, email, isAnonymous, userId } = useAnonSession();

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <Suspense fallback={null}>
          <AuthErrorBanner />
        </Suspense>
        <PageHeader />
        <div
          style={{
            paddingTop: "var(--space-kitchen)",
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
              animation: "profilePulse 1.6s var(--ease-in-out) infinite",
            }}
          >
            Developing…
          </span>
          <style>{`
            @keyframes profilePulse {
              0%, 100% { opacity: 0.30; }
              50%       { opacity: 0.65; }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (error || !session || !userId) {
    return (
      <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <Suspense fallback={null}>
          <AuthErrorBanner />
        </Suspense>
        <PageHeader />
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
          {error?.message ?? "No session — try reopening the app."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <Suspense fallback={null}>
        <AuthErrorBanner />
      </Suspense>
      <PageHeader />
      <div
        style={{
          paddingLeft: "var(--space-counter)",
          paddingRight: "var(--space-counter)",
          paddingBottom: "var(--space-kitchen)",
        }}
      >
        {isAnonymous ? (
          <AnonymousView userId={userId} />
        ) : (
          <EmailView userId={userId} email={email} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PageHeader
// ─────────────────────────────────────────────────────────────────────────────

function PageHeader() {
  return (
    <header
      style={{
        paddingLeft: "var(--space-counter)",
        paddingRight: "var(--space-counter)",
        paddingTop: "var(--space-room)",
        paddingBottom: "var(--space-shelf)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          height: "1px",
          background: "var(--border-crumb)",
          marginBottom: "var(--space-bite)",
          width: "40px",
        }}
      />
      <h1
        style={{
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 144, "SOFT" 100, "wght" 500',
          fontSize: "clamp(28px, 8vw, 40px)",
          letterSpacing: "var(--tracking-tight)",
          lineHeight: 1.1,
          color: "var(--fg-crema)",
          margin: 0,
        }}
      >
        Profile
      </h1>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AnonymousView — email-upgrade entry point
// ─────────────────────────────────────────────────────────────────────────────

function AnonymousView({ userId }: { userId: string }) {
  const [emailInput, setEmailInput] = useState("");
  const [inflight, setInflight] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inflight) return;
    const trimmed = emailInput.trim();
    if (!trimmed || !trimmed.includes("@")) {
      showToast({ message: "Enter a valid email address", icon: "error" });
      return;
    }

    setInflight(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser(
        { email: trimmed },
        { emailRedirectTo: `${window.location.origin}/auth/callback` }
      );
      if (error) {
        // Supabase replies "A user with this email address has already been
        // registered" when the address is in use. Surface verbatim — it's
        // helpful, and we don't want to leak whether it's a separate account.
        throw error;
      }
      setSent(trimmed);
    } catch (err) {
      console.error("[Profile] updateUser failed:", err);
      const msg = err instanceof Error ? err.message : "Couldn't send the link";
      showToast({ message: msg, icon: "error", duration: 4500 });
    } finally {
      setInflight(false);
    }
  }

  if (sent) {
    return (
      <div style={{ paddingTop: "var(--space-shelf)" }}>
        <p
          style={{
            color: "var(--fg-crema)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
            fontSize: "18px",
            lineHeight: 1.4,
            margin: 0,
            marginBottom: "var(--space-plate)",
          }}
        >
          Check your inbox.
        </p>
        <p
          style={{
            color: "var(--fg-smoke)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
            fontSize: "13px",
            lineHeight: 1.6,
            margin: 0,
            marginBottom: "var(--space-shelf)",
          }}
        >
          We sent a confirmation link to{" "}
          <strong style={{ color: "var(--fg-crema)", fontWeight: 500 }}>{sent}</strong>.
          Click the link to attach this email to your DietLens account. All
          your existing meals will stay yours.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(null);
            setEmailInput("");
          }}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--fg-chalk-dust)",
            fontFamily: "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
            fontSize: "12px",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
          }}
        >
          Use a different email
        </button>
        <UserIdFooter userId={userId} />
      </div>
    );
  }

  return (
    <div style={{ paddingTop: "var(--space-shelf)" }}>
      <p
        style={{
          color: "var(--fg-crema)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
          fontSize: "18px",
          lineHeight: 1.4,
          margin: 0,
          marginBottom: "var(--space-plate)",
        }}
      >
        You're using DietLens anonymously.
      </p>
      <p
        style={{
          color: "var(--fg-smoke)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
          fontSize: "13px",
          lineHeight: 1.6,
          margin: 0,
          marginBottom: "var(--space-shelf)",
        }}
      >
        Add an email to find friends and share what you've been eating.
        Your meals stay yours either way.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-bite)" }}>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="you@example.com"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          disabled={inflight}
          aria-label="Email address"
          style={{
            width: "100%",
            padding: "12px 14px",
            background: "var(--bg-ember-black)",
            border: "1px solid var(--border-crumb)",
            borderRadius: "var(--radius-knob)",
            color: "var(--fg-crema)",
            fontFamily: "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
            fontSize: "15px",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={inflight}
          style={{
            padding: "12px 16px",
            background: "var(--safelight, #E07B3A)",
            border: "none",
            borderRadius: "var(--radius-knob)",
            color: "var(--bg-cast-iron)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 600',
            fontSize: "15px",
            cursor: inflight ? "wait" : "pointer",
            opacity: inflight ? 0.6 : 1,
            transition: "opacity var(--dur-fast) var(--ease-out)",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {inflight ? "Sending…" : "Send me a magic link"}
        </button>
      </form>

      <UserIdFooter userId={userId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmailView — signed-in with email
// ─────────────────────────────────────────────────────────────────────────────

function EmailView({ userId, email }: { userId: string; email: string | null }) {
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string | null>(null);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (err) {
      console.error("[Profile] sign out failed:", err);
      showToast({ message: "Couldn't sign out — try again", icon: "error" });
      setSigningOut(false);
    }
  }

  return (
    <div style={{ paddingTop: "var(--space-shelf)" }}>
      {/* Avatar + editable name + email cluster */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-plate)",
          alignItems: "center",
          marginBottom: "var(--space-shelf)",
        }}
      >
        <MonogramAvatar seed={userId} displayName={displayName} size={64} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <DisplayNameField userId={userId} onChange={setDisplayName} />
          <p
            style={{
              color: "var(--fg-smoke)",
              fontFamily:
                "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
              fontSize: "12px",
              margin: 0,
              marginTop: "var(--space-crumb)",
              wordBreak: "break-all",
            }}
          >
            {email ?? "(no email)"}
          </p>
        </div>
      </div>

      <ProfileStats userId={userId} />

      <InviteForm />

      <FollowLists userId={userId} />

      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        style={{
          background: "none",
          border: "1px solid var(--border-crumb)",
          padding: "10px 16px",
          borderRadius: "var(--radius-knob)",
          cursor: signingOut ? "wait" : "pointer",
          color: "var(--fg-smoke)",
          fontFamily: "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
          fontSize: "13px",
          opacity: signingOut ? 0.6 : 1,
        }}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>

      <UserIdFooter userId={userId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DisplayNameField — editable name with save-on-blur. Reads/writes
// public.profiles.display_name. Calls onChange whenever the saved value
// shifts so the parent can pass it into the avatar.
// ─────────────────────────────────────────────────────────────────────────────

function DisplayNameField({
  userId,
  onChange,
}: {
  userId: string;
  onChange?: (name: string | null) => void;
}) {
  const [value, setValue] = useState<string>("");
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load current value.
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled) return;
      const name = (data?.display_name as string | null) ?? null;
      setSavedValue(name);
      setValue(name ?? "");
      setLoaded(true);
      onChange?.(name);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, onChange]);

  async function commit() {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === savedValue) return; // no-op
    setSaving(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: next })
        .eq("id", userId);
      if (error) throw error;
      setSavedValue(next);
      onChange?.(next);
    } catch (err) {
      console.error("[DisplayNameField] save failed:", err);
      showToast({ message: "Couldn't save name — try again", icon: "error" });
      setValue(savedValue ?? "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setValue(savedValue ?? "");
            inputRef.current?.blur();
          }
        }}
        placeholder={loaded ? "Add your name" : "…"}
        disabled={!loaded || saving}
        aria-label="Display name"
        style={{
          width: "100%",
          padding: "2px 0",
          background: "transparent",
          border: "none",
          borderBottom: "1px dashed transparent",
          color: "var(--fg-crema)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
          fontSize: "20px",
          lineHeight: 1.2,
          outline: "none",
          letterSpacing: "var(--tracking-tight)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderBottomColor = "var(--border-crumb)";
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderBottomColor = "transparent";
        }}
      />
      {saving && (
        <span
          style={{
            position: "absolute",
            right: 0,
            top: "calc(50% - 6px)",
            color: "var(--fg-smoke)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
            fontSize: "10px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.7,
          }}
        >
          Saving…
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ProfileStats — four-cell stats row (meals / photos / followers / following).
// Each cell fetches its own count in parallel; cells render skeletons until
// their query resolves.
// ─────────────────────────────────────────────────────────────────────────────

interface Stats {
  meals: number | null;
  photos: number | null;
  followers: number | null;
  following: number | null;
}

function ProfileStats({ userId }: { userId: string }) {
  const [stats, setStats] = useState<Stats>({
    meals: null,
    photos: null,
    followers: null,
    following: null,
  });

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    (async () => {
      const [mealsRes, photosRes, followersRes, followingRes] = await Promise.all([
        supabase
          .from("meals")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId),
        supabase
          .from("meal_photos")
          .select("meals!inner(user_id)", { count: "exact", head: true })
          .eq("meals.user_id", userId),
        supabase
          .from("follows")
          .select("*", { count: "exact", head: true })
          .eq("followee_id", userId),
        supabase
          .from("follows")
          .select("*", { count: "exact", head: true })
          .eq("follower_id", userId),
      ]);
      if (cancelled) return;
      setStats({
        meals: mealsRes.count ?? 0,
        photos: photosRes.count ?? 0,
        followers: followersRes.count ?? 0,
        following: followingRes.count ?? 0,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "var(--space-bite)",
        padding: "var(--space-plate) 0",
        borderTop: "1px solid var(--border-crumb)",
        borderBottom: "1px solid var(--border-crumb)",
        marginBottom: "var(--space-shelf)",
      }}
    >
      <StatCell label="Meals" value={stats.meals} />
      <StatCell label="Photos" value={stats.photos} />
      <StatCell label="Followers" value={stats.followers} />
      <StatCell label="Following" value={stats.following} />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span
        style={{
          color: "var(--fg-crema)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
          fontFeatureSettings: '"tnum"',
          fontSize: "18px",
          lineHeight: 1,
        }}
      >
        {value === null ? "—" : value}
      </span>
      <span
        style={{
          color: "var(--fg-smoke)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
          fontSize: "10px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InviteForm — POST /api/invites + render the magic-link confirmation.
// Visible only on the EmailView; the API rejects anon callers.
// ─────────────────────────────────────────────────────────────────────────────

function InviteForm() {
  const [emailInput, setEmailInput] = useState("");
  const [inflight, setInflight] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inflight) return;
    const trimmed = emailInput.trim();
    if (!trimmed || !trimmed.includes("@")) {
      showToast({ message: "Enter a valid email address", icon: "error" });
      return;
    }
    setInflight(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Invite failed (${res.status})`);
      }
      setSentTo(trimmed);
      setEmailInput("");
    } catch (err) {
      console.error("[InviteForm] failed:", err);
      const msg = err instanceof Error ? err.message : "Couldn't send the invite";
      showToast({ message: msg, icon: "error", duration: 4500 });
    } finally {
      setInflight(false);
    }
  }

  return (
    <section style={{ marginTop: "var(--space-shelf)" }}>
      <h2
        style={{
          color: "var(--fg-smoke)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
          fontSize: "11px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          margin: 0,
          marginBottom: "var(--space-bite)",
        }}
      >
        Invite a friend
      </h2>

      {sentTo && (
        <p
          style={{
            color: "var(--fg-crema)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
            fontSize: "13px",
            lineHeight: 1.6,
            margin: 0,
            marginBottom: "var(--space-bite)",
          }}
        >
          Sent to <strong style={{ fontWeight: 500 }}>{sentTo}</strong>. They'll be
          following you (and you'll be following them) once they accept.
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: "var(--space-bite)", flexWrap: "wrap" }}
      >
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="friend@example.com"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          disabled={inflight}
          aria-label="Friend's email address"
          style={{
            flex: "1 1 200px",
            minWidth: 0,
            padding: "10px 12px",
            background: "var(--bg-ember-black)",
            border: "1px solid var(--border-crumb)",
            borderRadius: "var(--radius-knob)",
            color: "var(--fg-crema)",
            fontFamily:
              "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
            fontSize: "14px",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={inflight}
          style={{
            padding: "10px 16px",
            background: "var(--safelight, #E07B3A)",
            border: "none",
            borderRadius: "var(--radius-knob)",
            color: "var(--bg-cast-iron)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 600',
            fontSize: "14px",
            cursor: inflight ? "wait" : "pointer",
            opacity: inflight ? 0.6 : 1,
            transition: "opacity var(--dur-fast) var(--ease-out)",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {inflight ? "Sending…" : "Send invite"}
        </button>
      </form>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FollowLists — Following + Followers lists rendered as two stacked sections.
// Each row links to /u/[id]. Empty states nudge toward inviting / sharing.
// ─────────────────────────────────────────────────────────────────────────────

interface ListedUser {
  id: string;
  displayName: string | null;
}

function FollowLists({ userId }: { userId: string }) {
  const [following, setFollowing] = useState<ListedUser[] | null>(null);
  const [followers, setFollowers] = useState<ListedUser[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    async function load() {
      // 1. Fetch the two edge sets in parallel.
      const [followingRes, followersRes] = await Promise.all([
        supabase.from("follows").select("followee_id").eq("follower_id", userId),
        supabase.from("follows").select("follower_id").eq("followee_id", userId),
      ]);
      if (cancelled) return;

      const followingIds: string[] =
        (followingRes.data ?? []).map((r: { followee_id: string }) => r.followee_id);
      const followerIds: string[] =
        (followersRes.data ?? []).map((r: { follower_id: string }) => r.follower_id);

      // 2. Resolve display names in one query for both lists combined.
      const allIds = Array.from(new Set([...followingIds, ...followerIds]));
      const profileMap = new Map<string, string | null>();

      if (allIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, display_name")
          .in("id", allIds);
        if (cancelled) return;
        for (const p of (profilesData ?? []) as { id: string; display_name: string | null }[]) {
          profileMap.set(p.id, p.display_name);
        }
      }

      const mkRow = (id: string): ListedUser => ({
        id,
        displayName: profileMap.get(id) ?? null,
      });

      setFollowing(followingIds.map(mkRow));
      setFollowers(followerIds.map(mkRow));
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div style={{ marginBottom: "var(--space-shelf)" }}>
      <ListSection
        title="Following"
        users={following}
        emptyCopy="You're not following anyone yet. Share your invite link to bring friends in."
      />
      <ListSection
        title="Followers"
        users={followers}
        emptyCopy="No followers yet. They'll show up here when they join via your invite."
      />
    </div>
  );
}

function ListSection({
  title,
  users,
  emptyCopy,
}: {
  title: string;
  users: ListedUser[] | null;
  emptyCopy: string;
}) {
  return (
    <section style={{ marginTop: "var(--space-shelf)" }}>
      <h2
        style={{
          color: "var(--fg-smoke)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
          fontSize: "11px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          margin: 0,
          marginBottom: "var(--space-bite)",
        }}
      >
        {title}
        {users && (
          <span
            style={{
              opacity: 0.7,
              marginLeft: "6px",
              fontFeatureSettings: '"tnum"',
            }}
          >
            {users.length}
          </span>
        )}
      </h2>

      {users === null ? (
        <p
          style={{
            color: "var(--fg-smoke)",
            opacity: 0.55,
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
            fontSize: "12px",
            margin: 0,
          }}
        >
          Developing…
        </p>
      ) : users.length === 0 ? (
        <p
          style={{
            color: "var(--fg-smoke)",
            fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
            fontVariationSettings: '"opsz" 11, "SOFT" 100, "wght" 400',
            fontSize: "13px",
            lineHeight: 1.6,
            margin: 0,
            maxWidth: "320px",
          }}
        >
          {emptyCopy}
        </p>
      ) : (
        <ul
          role="list"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {users.map((u) => (
            <li key={u.id}>
              <Link
                href={`/u/${u.id}`}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "10px",
                  padding: "10px 0",
                  color: "var(--fg-crema)",
                  textDecoration: "none",
                  fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
                  fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
                  fontSize: "15px",
                  borderBottom: "1px solid var(--border-crumb)",
                }}
              >
                <span style={{ flex: 1, wordBreak: "break-word" }}>
                  {u.displayName ?? <span style={{ opacity: 0.6 }}>Anonymous archive</span>}
                </span>
                <span
                  style={{
                    color: "var(--fg-smoke)",
                    fontSize: "11px",
                    opacity: 0.7,
                  }}
                >
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UserIdFooter — chalked debug-ish id at the bottom of both views.
// Useful when aish is testing on multiple devices.
// ─────────────────────────────────────────────────────────────────────────────

function UserIdFooter({ userId }: { userId: string }) {
  return (
    <p
      style={{
        marginTop: "var(--space-room)",
        color: "var(--fg-smoke)",
        opacity: 0.55,
        fontFamily: "var(--font-jetbrains-mono, var(--font-fraunces)), monospace",
        fontSize: "10px",
        letterSpacing: "0.02em",
        userSelect: "all",
        wordBreak: "break-all",
      }}
    >
      {userId}
    </p>
  );
}
