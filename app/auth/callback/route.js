// Where every emailed link lands: confirm-your-address, password reset, and
// any future magic link.
//
// The email contains a one-time code, not a session. This route trades that
// code for a real session cookie and then sends the visitor on. It has to be a
// route handler rather than a page, because only route handlers and server
// actions are allowed to write cookies.
//
// Two shapes of link arrive here, and which one depends on how the Supabase
// email template is written:
//
//   ?code=...                     the newer flow. Exchanged for a session.
//   ?token_hash=...&type=signup   the older template style. Verified as an OTP.
//
// Both are handled, so changing the email template later cannot silently break
// confirmation for every new family.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  // Only ever redirect to a path on this site. Taking a full URL from the
  // query string and redirecting to it is the open-redirect bug -- it lets
  // someone send out a link that looks like ours and lands somewhere else.
  const rawNext = searchParams.get('next') || '/account/dashboard/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//')
    ? rawNext
    : '/account/dashboard/';

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Expired link, already-used link, or a link opened in a different browser
  // from the one that requested it. All three are ordinary, so the message
  // says what to do rather than what went wrong.
  return NextResponse.redirect(`${origin}/account/link-expired/`);
}
