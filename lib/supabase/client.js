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

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        // WHY THIS IS HERE -- do not remove without reading this.
        //
        // @supabase/ssr defaults every client to the PKCE flow. PKCE is the
        // right choice for social logins, but it quietly breaks emailed links,
        // and it breaks them in the one way that testing never catches.
        //
        // Under PKCE, signUp() and resetPasswordForEmail() generate a secret
        // "code verifier" and store it in THIS browser. The link Supabase then
        // emails carries a token that is useless on its own -- you can see it
        // in the email, it starts with `pkce_`. Confirming the account means
        // sending that token back TOGETHER WITH the verifier, so the link only
        // works in the same browser, on the same device, that signed up.
        //
        // Supabase says so plainly: "the code exchange must be initiated on the
        // same browser and device where the flow was started."
        //
        // That is fine for whoever is testing -- they sign up and click the
        // link in the same window, and it works every time. It is not fine for
        // a parent who registers on the family laptop and then opens the email
        // on their phone, which is what people actually do. They would get the
        // "that link didn't work" page forever, and no amount of resending
        // would help, because every new link has the same problem.
        //
        // 'implicit' makes Supabase email an ordinary one-time token instead,
        // which app/auth/callback/route.js verifies server-side with
        // verifyOtp(). That works from any device, which is the whole point.
        //
        // The usual warning about the implicit flow -- that it hands tokens to
        // the browser in the URL fragment, where server code cannot see them --
        // does not apply here. It only concerns the OAuth redirect, and this
        // site has no social logins: sign-in is password + optional TOTP, and
        // the session cookie is written server-side by the callback route.
        // If a "Sign in with Google" button is ever added, revisit this.
        flowType: 'implicit',
      },
    }
  );
}
