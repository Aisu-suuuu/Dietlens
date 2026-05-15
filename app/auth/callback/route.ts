/**
 * /auth/callback — magic-link callback (Wave 2)
 *
 * Supabase magic-link emails redirect here with a `?code=` (PKCE flow) or
 * `?token_hash=` (older OTP flow). Both are exchanged for a real session
 * via @supabase/ssr and the resulting cookies are written to the response.
 *
 * After a successful exchange:
 *   - If `?next=` is set, redirect there. Used by /profile to come back
 *     after upgrade and by Wave 4 invites to land on /u/<inviter>.
 *   - Otherwise redirect to /profile (the default for fresh upgrades).
 *
 * Failure modes are all sent to /profile with `?auth_error=<reason>` so the
 * client can surface a friendly toast without us needing a dedicated error
 * page for an edge case.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type"); // 'email' | 'magiclink' | 'recovery' | ...
  const next = url.searchParams.get("next") || "/profile";

  // Normalize the redirect target so we never bounce a user off-site via a
  // crafted ?next= parameter. Only same-origin paths are accepted.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/profile";

  const supabase = await createSupabaseServerClient();

  // ── Path 1: PKCE — Supabase's preferred flow as of @supabase/ssr 0.5+ ──
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        `${url.origin}/profile?auth_error=${encodeURIComponent(error.message)}`
      );
    }
    return NextResponse.redirect(`${url.origin}${safeNext}`);
  }

  // ── Path 2: OTP token_hash — used when email-change confirmation arrives
  //    via the older magic-link template ─────────────────────────────────
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "email" | "magiclink" | "recovery" | "invite" | "email_change",
    });
    if (error) {
      return NextResponse.redirect(
        `${url.origin}/profile?auth_error=${encodeURIComponent(error.message)}`
      );
    }
    return NextResponse.redirect(`${url.origin}${safeNext}`);
  }

  // No usable parameters — surface a generic error.
  return NextResponse.redirect(
    `${url.origin}/profile?auth_error=missing_token`
  );
}
