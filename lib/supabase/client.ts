import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseBrowserClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Singleton — memoized across re-renders so we don't recreate the client on
// every hook call. Only valid in browser context.
let _browserClient: SupabaseClient | undefined;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    // SSR safety: never memoize on the server
    return createSupabaseBrowserClient();
  }
  if (!_browserClient) {
    _browserClient = createSupabaseBrowserClient();
  }
  return _browserClient;
}
