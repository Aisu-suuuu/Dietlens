"use client";

import { useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// ensureAnonSession
// ---------------------------------------------------------------------------

/**
 * Ensures the browser has an active anonymous Supabase session.
 *
 * 1. Calls getSession() — if an existing session is found (persisted via
 *    localStorage), it is returned immediately. This handles the common case
 *    of a returning user and prevents a double sign-in race across tabs.
 * 2. If no session exists, calls signInAnonymously().
 * 3. On auth-disabled or any other error, throws a descriptive Error that
 *    the UI can surface.
 *
 * @throws {Error} with a user-readable message on failure
 */
export async function ensureAnonSession(
  supabase: SupabaseClient
): Promise<Session> {
  // Step 1: check for an existing session (covers refresh token resume + race)
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(`Failed to read existing session: ${sessionError.message}`);
  }

  if (sessionData.session) {
    return sessionData.session;
  }

  // Step 2: no session found — sign in anonymously
  const { data: signInData, error: signInError } =
    await supabase.auth.signInAnonymously();

  if (signInError) {
    // Surface a helpful message for the most common misconfiguration
    if (
      signInError.message.toLowerCase().includes("anonymous") ||
      signInError.message.toLowerCase().includes("provider") ||
      signInError.status === 422
    ) {
      throw new Error(
        "Anonymous sign-in is disabled in Supabase dashboard — enable under " +
          "Authentication → Providers → Anonymous Sign-ins"
      );
    }
    throw new Error(`Anonymous sign-in failed: ${signInError.message}`);
  }

  if (!signInData.session) {
    throw new Error(
      "signInAnonymously() returned no session. Check your Supabase project settings."
    );
  }

  return signInData.session;
}

// ---------------------------------------------------------------------------
// useAnonSession hook
// ---------------------------------------------------------------------------

export interface AnonSessionState {
  session: Session | null;
  loading: boolean;
  error: Error | null;
  userId: string | null;
}

/**
 * React hook that manages the anonymous Supabase session lifecycle.
 *
 * - On mount: calls ensureAnonSession() with a 10s offline timeout.
 * - Subscribes to onAuthStateChange for future updates (token refresh, etc.).
 * - Returns { session, loading, error, userId }.
 *
 * Edge cases:
 * - Offline at first load → loading becomes false and error is set after 10s.
 * - Two tabs: getSession() check in ensureAnonSession() prevents double sign-in.
 * - Anonymous sign-in disabled: error.message carries an actionable hint.
 */
export function useAnonSession(): AnonSessionState {
  const [state, setState] = useState<AnonSessionState>({
    session: null,
    loading: true,
    error: null,
    userId: null,
  });

  // Stable ref so the auth state change listener always sees the latest state
  // without causing the effect to re-run.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    // Offline guard — if ensureAnonSession() hasn't resolved after 10s,
    // report an offline error so the UI can render cached content.
    const offlineTimer = setTimeout(() => {
      if (cancelled) return;
      if (stateRef.current.loading) {
        setState({
          session: null,
          loading: false,
          error: new Error(
            "Could not establish a session — you appear to be offline. " +
              "Some features may be unavailable."
          ),
          userId: null,
        });
      }
    }, 10_000);

    // Subscribe to auth state changes first so we never miss an event that
    // fires during the async ensureAnonSession() call.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      clearTimeout(offlineTimer);
      setState({
        session,
        loading: false,
        error: null,
        userId: session?.user?.id ?? null,
      });
    });

    // Kick off the session bootstrap
    ensureAnonSession(supabase)
      .then((session) => {
        if (cancelled) return;
        clearTimeout(offlineTimer);
        // onAuthStateChange may have already updated state; only override if
        // we're still loading (i.e., the event hasn't fired yet).
        if (stateRef.current.loading) {
          setState({
            session,
            loading: false,
            error: null,
            userId: session.user?.id ?? null,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        clearTimeout(offlineTimer);
        const error = err instanceof Error ? err : new Error(String(err));
        setState({
          session: null,
          loading: false,
          error,
          userId: null,
        });
      });

    return () => {
      cancelled = true;
      clearTimeout(offlineTimer);
      subscription.unsubscribe();
    };
  }, []); // run once on mount

  return state;
}
