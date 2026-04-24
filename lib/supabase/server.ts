import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for RSC and API routes.
 * Uses Next.js 16 async cookies() API — must be awaited.
 * Creates a new client per request; never share across requests.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  // Next.js 16: cookies() is async — must await
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll called from a Server Component — cookies cannot be set
            // during rendering. This is expected when the client is used for
            // read-only operations in RSC. Token refresh writes should go
            // through middleware or Route Handlers.
          }
        },
      },
    }
  );
}

/**
 * Privileged Supabase client using the service role key.
 * For server-only operations like cron jobs or admin tasks.
 * Does NOT use cookies — bypasses RLS.
 * Never expose this client to the browser.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
