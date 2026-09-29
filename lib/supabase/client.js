// Supabase client for code that runs in the BROWSER.
//
// Use this in any component with 'use client' at the top. For code that runs
// on the server -- page.jsx files without 'use client', route handlers,
// server actions -- use lib/supabase/server.js instead. They are not
// interchangeable: this one reads cookies through the browser, that one reads
// them through Next's request object.
//
// Both keys below are safe to send to the browser. That is what the
// NEXT_PUBLIC_ prefix means -- Next.js compiles those values into the
// JavaScript every visitor downloads. The anon key is designed for this: on
// its own it grants nothing, because every table has row-level security and
// the policies decide what the logged-in user may see.
//
// The service role key is a different thing entirely and must never appear in
// a file that a browser can load. See .env.example.
//
// WHY THERE ARE NO AUTH OPTIONS HERE -- read before adding one.
//
// Until 29 Sep 2026 this passed { auth: { flowType: 'implicit' } }, meant to
// stop emailed links working only in the browser that asked for them (the
// PKCE "code verifier" lives in that browser, so a parent who registers on
// the laptop and opens the email on their phone would be stuck). It never
// took effect. createBrowserClient spreads our auth options FIRST and then
// sets flowType: 'pkce' after them, so PKCE always wins -- see
// node_modules/@supabase/ssr/dist/main/createBrowserClient.js (0.12.4). The
// emails show it: their tokens start with `pkce_`.
//
// What actually makes a link work on any device is app/auth/confirm/page.jsx.
// The Supabase email templates point there, and its button calls verifyOtp()
// with the token_hash on the server. That needs no code verifier, so the one
// PKCE leaves in this browser simply goes unused. See DECISIONS.md,
// 2026-09-29.
//
// So do not put flowType back expecting it to change anything. The thing to
// protect is the templates: if they are ever pointed back at /auth/callback
// with {{ .ConfirmationURL }}, the ?code= links that result ARE tied to one
// browser again.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
