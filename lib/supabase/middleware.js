// Session refresh, and the gate on signed-in pages.
//
// A Supabase session is a short-lived access token plus a long-lived refresh
// token, both kept in cookies. The access token expires after an hour. Nothing
// in the browser can refresh a cookie that a server-rendered page is about to
// read -- by the time the page renders, the request is already in flight. So
// the refresh happens here, in middleware, before any page runs.
//
// Skip this and everything works for about an hour, then people start getting
// logged out mid-form with no error message and no pattern anyone can repeat.
// That is the bug this file exists to prevent.
//
// It does one other job: it keeps anonymous visitors out of the signed-in
// area. That is a convenience, not the security boundary. The real boundary is
// row-level security in the database -- see supabase/migrations/. If this file
// were deleted tomorrow, nobody could read another family's data; they would
// just see an empty page instead of being redirected to the login screen.

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

// Anything under one of these prefixes requires a logged-in user.
// /account/reset-password is here because arriving from a password-reset email
// puts a real session in place first -- so someone who followed the link gets
// straight in, and someone who typed the URL from memory gets the login screen
// instead of a form that cannot work. /account/security is a signed-in page too.
const PROTECTED_PREFIXES = [
  '/account/dashboard',
  '/account/reset-password',
  '/account/security',
];

// Pages a logged-in user has no reason to see. Landing on one sends them to
// the dashboard instead.
const SIGNED_OUT_ONLY = ['/account/signup'];

export async function updateSession(request) {
  // Start from a response that carries the incoming request through unchanged.
  // Supabase may hand us refreshed cookies below; they have to be written to
  // BOTH the request (so the page rendering after us sees them) and the
  // response (so the browser stores them).
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not remove this call, and do not replace it with getSession().
  // getUser() is what actually triggers the token refresh, and it verifies the
  // token with Supabase rather than trusting whatever the cookie says.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && PROTECTED_PREFIXES.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/account/';
    // Remember where they were headed so login can send them back there.
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (user && SIGNED_OUT_ONLY.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = '/account/dashboard/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Return this exact object. Building a fresh NextResponse here and copying
  // the body over would drop the refreshed cookies set above, and sessions
  // would quietly stop persisting.
  return supabaseResponse;
}
