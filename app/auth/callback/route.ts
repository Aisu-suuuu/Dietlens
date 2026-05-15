/**
 * /auth/callback — magic-link callback (Wave 2 + Wave 4)
 *
 * Supabase magic-link emails redirect here with a `?code=` (PKCE flow) or
 * `?token_hash=` (legacy OTP flow). Both are exchanged for a real session
 * via @supabase/ssr and the resulting cookies are written to the response.
 *
 * After a successful exchange:
 *   - If `?invite=<token>` is present, resolve the invite row server-side
 *     (service role bypasses RLS so the new user can read someone else's
 *     invites.token), insert a MUTUAL follow edge between inviter and
 *     accepted_by, mark the invite accepted, and redirect to /u/<inviter>.
 *     This is the only place in the app where mutuality is enforced.
 *   - Else if `?next=` is set, redirect there.
 *   - Else redirect to /profile.
 *
 * Failure modes are all sent to /profile with `?auth_error=<reason>` so the
 * client can surface a friendly toast.
 */

import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type"); // 'email' | 'magiclink' | 'recovery' | ...
  const inviteToken = url.searchParams.get("invite");
  const nextParam = url.searchParams.get("next");

  const supabase = await createSupabaseServerClient();

  // ── Step 1: complete the auth exchange ───────────────────────────────────
  let exchangeError: string | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) exchangeError = error.message;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "email" | "magiclink" | "recovery" | "invite" | "email_change",
    });
    if (error) exchangeError = error.message;
  } else {
    exchangeError = "missing_token";
  }

  if (exchangeError) {
    return NextResponse.redirect(
      `${url.origin}/profile?auth_error=${encodeURIComponent(exchangeError)}`
    );
  }

  // ── Step 2: who are we now? ──────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      `${url.origin}/profile?auth_error=session_lost_after_exchange`
    );
  }

  // ── Step 3: if there's an invite token, resolve it ───────────────────────
  // We use the service-role client because the new user can't see other
  // people's invite rows under RLS. Token knowledge is the gate.
  let redirectTarget = safeNext(nextParam, "/profile");

  if (inviteToken) {
    const service = createSupabaseServiceClient();

    const { data: inviteRow, error: inviteError } = await service
      .from("invites")
      .select("token, inviter_id, accepted_at")
      .eq("token", inviteToken)
      .maybeSingle();

    if (inviteError) {
      // Don't block the user from finishing sign-in — fall through to the
      // default redirect and surface a soft error.
      console.warn("[auth/callback] invite lookup failed:", inviteError.message);
    } else if (inviteRow && inviteRow.inviter_id !== user.id) {
      // 3a. Insert the mutual follow (both directions). `on conflict do
      //     nothing` shape comes from upsert with ignoreDuplicates so
      //     re-clicking the link doesn't error.
      const { error: followError } = await service.from("follows").upsert(
        [
          { follower_id: inviteRow.inviter_id, followee_id: user.id },
          { follower_id: user.id, followee_id: inviteRow.inviter_id },
        ],
        { onConflict: "follower_id,followee_id", ignoreDuplicates: true }
      );
      if (followError) {
        console.warn("[auth/callback] mutual follow insert failed:", followError.message);
      }

      // 3b. Mark the invite accepted (only the first acceptance writes — we
      //     don't overwrite if it was already claimed).
      if (!inviteRow.accepted_at) {
        const { error: acceptError } = await service
          .from("invites")
          .update({
            accepted_at: new Date().toISOString(),
            accepted_by: user.id,
          })
          .eq("token", inviteToken)
          .is("accepted_at", null);
        if (acceptError) {
          console.warn("[auth/callback] invite mark-accepted failed:", acceptError.message);
        }
      }

      // 3c. New user lands on the inviter's profile so the first thing
      //     they see is what their friend has been eating.
      redirectTarget = `/u/${inviteRow.inviter_id}`;
    }
  }

  return NextResponse.redirect(`${url.origin}${redirectTarget}`);
}

/**
 * Same-origin guard for the `?next=` redirect target so a crafted URL can't
 * bounce a user off-site.
 */
function safeNext(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return fallback;
}
