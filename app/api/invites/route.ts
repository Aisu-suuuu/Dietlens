/**
 * /api/invites — create an invite + send the magic link (Wave 4)
 *
 * POST body: { email: string }
 *
 * Behaviour:
 *   1. Require the caller to have a session (we use the SSR cookie-aware
 *      client). If the caller is still anonymous, refuse — anon users
 *      shouldn't be able to invite anyone because we have nothing useful to
 *      tie the resulting follow back to.
 *   2. Generate a 16-character token and INSERT the invite row.
 *   3. Call supabase.auth.signInWithOtp({ email, emailRedirectTo:
 *      `${origin}/auth/callback?invite=${token}` }) so the invitee gets a
 *      magic link that brings them back through our callback with the
 *      token attached. signInWithOtp handles both "new user signup" and
 *      "existing user sign-in" via the same flow.
 *   4. Respond { ok: true, token } so the client can show a "Sent to
 *      <email>" confirmation.
 *
 * The acceptance + mutual-follow side of the flow lives in
 * /auth/callback/route.ts.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface InviteBody {
  email?: string;
}

// Crude RFC-ish email check — good enough to reject typos. Real validation
// happens server-side at Supabase auth.
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function generateToken(): string {
  // 16 url-safe chars, derived from a v4 UUID for simplicity (no nanoid dep).
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function POST(request: Request) {
  let body: InviteBody;
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !looksLikeEmail(email)) {
    return NextResponse.json({ error: "Provide a valid email address" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  // Identify the caller.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (user.is_anonymous) {
    return NextResponse.json(
      {
        error:
          "Add your email on /profile before inviting friends — invitees need a profile to follow back.",
      },
      { status: 403 }
    );
  }

  // Insert the invite row first so the token is on record even if the email
  // send fails. RLS gates the write to the inviter only.
  const token = generateToken();
  const { error: insertError } = await supabase.from("invites").insert({
    token,
    inviter_id: user.id,
    invitee_email: email,
  });

  if (insertError) {
    return NextResponse.json(
      { error: `Could not record invite: ${insertError.message}` },
      { status: 500 }
    );
  }

  // Send the magic link with the invite token attached to the redirect.
  // signInWithOtp creates a new auth.users row for first-time invitees and
  // sends a sign-in link for existing accounts — both paths land back at
  // /auth/callback?invite=<token>.
  const origin = new URL(request.url).origin;
  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/callback?invite=${token}`,
    },
  });

  if (otpError) {
    // Leave the invite row in place — aish can see it on /profile and the
    // invitee can still accept manually if they later sign up with the
    // same email and visit the redirect URL.
    return NextResponse.json(
      { error: `Couldn't send the email: ${otpError.message}`, token },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, token });
}
