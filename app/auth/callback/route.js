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

  // THE SECOND-REQUEST CASE -- read this before simplifying it away.
  //
  // Emailed links get fetched by things that are not the recipient. Mail
  // scanners, link-safety services and browser preloading all follow the URL
  // to see where it goes, and following it is enough to spend a one-time
  // token. The auth log for 20 August 2026 shows the shape exactly: a
  // successful /verify at 01:30:06, then "One-time token not found" at
  // 01:30:07 -- the same link, one second apart. The account was confirmed;
  // the person still got an error page, because their click was the second
  // request and the token was already gone.
  //
  // So a failure here does not mean the visitor is unauthenticated. If the
  // duplicate came from this same browser, the request that succeeded already
  // set the session cookie, and it is sitting in this very request. Check for
  // it before apologising. getUser() verifies with Supabase rather than
  // trusting the cookie, so this cannot be spoofed by forging one.
  //
  // This does NOT rescue the case where an outside scanner consumed the token,
  // because the scanner got the session and threw it away, and the person's
  // browser never had it. The durable fix for that is to stop consuming tokens
  // on GET at all -- land the email link on a page with a "Confirm" button and
  // spend the token on the POST, which scanners do not send. See DECISIONS.md.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) return NextResponse.redirect(`${origin}${next}`);

  // Genuinely expired, genuinely already used, or a link opened in a different
  // browser from the one that requested it. All three are ordinary, so the
  // message says what to do rather than what went wrong.
  return NextResponse.redirect(`${origin}/account/link-expired/`);
}
