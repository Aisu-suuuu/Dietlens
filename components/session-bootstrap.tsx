"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ensureAnonSession } from "@/lib/auth/anon-session";

/**
 * SessionBootstrap — Client Component
 *
 * Kicks off anonymous session creation on first mount. Renders nothing.
 * Designed to be placed once in the layout tree (e.g., app/layout.tsx).
 *
 * This component is intentionally minimal: it only bootstraps the session.
 * Components that need to react to session state should use useAnonSession().
 *
 * Error and loading states are NOT handled here — they are the responsibility
 * of the consuming components via the useAnonSession() hook.
 */
export default function SessionBootstrap() {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    // Fire-and-forget: ensureAnonSession handles the getSession() → signIn flow.
    // Errors are surfaced via onAuthStateChange to any useAnonSession() subscribers.
    ensureAnonSession(supabase).catch(() => {
      // Swallowed here — useAnonSession() will surface errors to the UI.
    });
  }, []); // run once on mount

  // Renders nothing — purely side-effectful
  return null;
}
