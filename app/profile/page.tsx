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

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAnonSession } from "@/lib/auth/anon-session";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { showToast } from "@/components/toast";

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
      <p
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
        Signed in as
      </p>
      <p
        style={{
          color: "var(--fg-crema)",
          fontFamily: "var(--font-fraunces), ui-serif, Georgia, serif",
          fontVariationSettings: '"opsz" 24, "SOFT" 50, "wght" 500',
          fontSize: "18px",
          lineHeight: 1.3,
          margin: 0,
          marginBottom: "var(--space-shelf)",
          wordBreak: "break-all",
        }}
      >
        {email ?? "(no email)"}
      </p>

      {/* Wave 3 will slot Following / Followers lists in this gap. */}
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
        Friends and invites are coming. For now: enjoy your archive.
      </p>

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
