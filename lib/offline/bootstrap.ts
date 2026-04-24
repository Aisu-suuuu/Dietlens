/**
 * bootstrap.ts — Wires automatic queue-drain to the browser's connectivity
 * and visibility events.
 *
 * Triggers:
 *   - `online` event          → the browser just reconnected
 *   - `visibilitychange` event → tab came back to the foreground (also covers
 *                                the case where a background tab missed the
 *                                `online` event entirely, which Chrome does
 *                                not dispatch to hidden tabs in some cases)
 *   - Initial call on install  → if already online, take a pass immediately
 *
 * The function returns a cleanup fn so the caller (SessionBootstrap) can
 * remove the listeners on unmount and avoid a double-install on fast refresh.
 *
 * All errors are swallowed — the sync function itself is non-throwing (it
 * returns a SyncResult) but the listener shell catches defensively so a
 * broken sync can never crash the host component.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { syncQueue } from "@/lib/offline/sync";

export function installOfflineSync(supabase: SupabaseClient): () => void {
  if (typeof window === "undefined") {
    // SSR safety — the caller is a client component, but defensive is cheap.
    return () => {};
  }

  // Fire-and-forget wrapper. The sync module already has its own mutex, so
  // repeat-calls are cheap; we don't need to debounce here.
  const trigger = () => {
    syncQueue(supabase).catch(() => {
      // syncQueue doesn't throw on normal failure paths, but if the IDB
      // layer itself is broken (storage evicted, private mode) we don't
      // want an unhandled rejection surfacing in the console.
    });
  };

  const onOnline = () => trigger();

  const onVisibility = () => {
    // Only useful when we're both visible AND online. A hidden tab has no
    // UI to update, and an online+hidden sync would still work but is also
    // a pointless battery drain while the user is elsewhere.
    if (document.visibilityState === "visible" && navigator.onLine) {
      trigger();
    }
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);

  // If we're already online at install time, take one pass now — this
  // handles the common case of the user refreshing the tab while there are
  // still queued meals from a previous session.
  if (navigator.onLine) {
    trigger();
  }

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
