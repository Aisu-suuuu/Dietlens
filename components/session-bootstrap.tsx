"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ensureAnonSession } from "@/lib/auth/anon-session";
import { installOfflineSync } from "@/lib/offline/bootstrap";

/**
 * SessionBootstrap — Client Component
 *
 * Kicks off anonymous session creation on first mount and installs the
 * offline-sync listeners. Renders nothing.
 * Designed to be placed once in the layout tree (e.g., app/layout.tsx).
 *
 * This component is intentionally minimal: it only bootstraps the session
 * and wires the `online`/visibilitychange listeners that drain the
 * IndexedDB queue when connectivity returns.
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

    // Install offline sync listeners (online event + visibilitychange). The
    // bootstrap module itself handles SSR-safety and is idempotent enough
    // that a re-install on fast refresh won't leak listeners — but we still
    // return its cleanup to match standard effect hygiene.
    //
    // We install BEFORE the session resolves because the queue is keyed by
    // localId (stable across sessions) and the sync function picks up the
    // authenticated supabase client at call time. If sync fires before the
    // session is ready, the insert will fail on RLS and the entry stays
    // queued — which is exactly the fallback we want.
    const uninstall = installOfflineSync(supabase);
    return uninstall;
  }, []); // run once on mount

  // Renders nothing — purely side-effectful
  return null;
}
