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
// It does two other jobs. It keeps anonymous visitors out of the signed-in
// area -- a convenience, not the security boundary; row-level security in the
// database is the real one. And it enforces the SECOND half of two-factor
// login, which is a real boundary and has to live here; see the aal check
// below for why.

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

// Anything under one of these prefixes requires a logged-in user.
// /account/reset-password is here because arriving from a password-reset email
// puts a real session in place first -- so someone who followed the link gets
// straight in, and someone who typed the URL from memory gets the login screen
// instead of a form that cannot work. /account/security is a signed-in page
// too. /admin has its own role checks in the layout, but belongs here as well
// so the two-factor rule below covers it.
const PROTECTED_PREFIXES = [
  '/account/dashboard',
  '/account/reset-password',
  '/account/security',
  '/admin',
];

// Pages a logged-in user has no reason to see. Landing on one sends them to
// the dashboard instead.
const SIGNED_OUT_ONLY = ['/account/signup'];

// The trusted-browser cookie. Written by the login form when someone passes
// two-factor and ticks "remember this browser"; holds a random token whose
// SHA-256 hash lives in mfa_trusted_devices. A cookie rather than
// localStorage because THIS file has to be able to check it, and middleware
// can read cookies but not a browser's localStorage.
const TRUST_COOKIE = 'l14_mfa_trust';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
  const isProtected = PROTECTED_PREFIXES.some((p) => path.startsWith(p));

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/account/';
    // Remember where they were headed so login can send them back there.
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // --- The two-factor gate. Read this before touching it. -------------------
  //
  // signInWithPassword creates a real session BEFORE the 6-digit code is ever
  // asked for -- the code step upgrades that session from aal1 to aal2, it
  // does not create it. So "backed out of the code screen" leaves a valid
  // aal1 session in the cookie, and any page that only asks "is someone
  // logged in?" would let it straight in. That was a live bug, found by a
  // person doing exactly that on 21 Aug 2026: password, back button, in.
  //
  // The rule: an enrolled account (nextLevel aal2) whose session has not
  // passed the code this time (currentLevel aal1) may not enter a protected
  // page -- UNLESS this browser holds a valid trusted-device token, because
  // "remember this browser for 30 days" works precisely by skipping the code
  // and therefore legitimately lives at aal1. The token's hash is checked
  // against mfa_trusted_devices server-side; RLS scopes that read to the
  // signed-in user's own rows, so one user's cookie cannot vouch for another.
  //
  // Accounts with no factor enrolled have nextLevel aal1 and skip all of
  // this, so families who never turned two-factor on are unaffected.
  if (user && isProtected) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
      let trusted = false;
      const token = request.cookies.get(TRUST_COOKIE)?.value;
      if (token) {
        try {
          const hash = await sha256Hex(token);
          const { data: device } = await supabase
            .from('mfa_trusted_devices')
            .select('id, expires_at')
            .eq('token_hash', hash)
            .maybeSingle();
          if (device && new Date(device.expires_at).getTime() > Date.now()) {
            trusted = true;
          }
        } catch {
          /* any failure means not trusted; never the other way round */
        }
      }
      if (!trusted) {
        const url = request.nextUrl.clone();
        url.pathname = '/account/';
        url.searchParams.set('next', path);
        // Tells the login form to open straight on the code step.
        url.searchParams.set('verify', '1');
        return NextResponse.redirect(url);
      }
    }
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
