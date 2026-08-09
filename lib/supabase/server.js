// Supabase client for code that runs on the SERVER.
//
// Use this in page.jsx files (the ones WITHOUT 'use client'), in route
// handlers under app/**/route.js, and in server actions. For browser code use
// lib/supabase/client.js.
//
// Why this is a function you have to await, rather than one shared client:
// each visitor has their own session, carried in their own cookies. A shared
// client would mean one visitor's session leaking into another's request. So
// a fresh client is built per request, from that request's cookies.
//
// In Next.js 15 cookies() is asynchronous, which is why this is `async` and
// why every call site writes `await createClient()`.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server components are not allowed to write cookies -- only route
            // handlers and server actions are. Reaching this catch is normal
            // and harmless: middleware.js has already refreshed the session
            // cookie for this request, so there is nothing to lose by
            // swallowing it here. Remove the middleware and sessions will
            // start expiring at odd moments with no obvious cause.
          }
        },
      },
    }
  );
}

// Convenience: who is logged in, or null.
//
// Always use this (or supabase.auth.getUser()) on the server, never
// getSession(). getSession reads the cookie and believes it. getUser asks
// Supabase to verify the token. On the server, where the answer decides what
// data someone sees, only the verified one is worth having.
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}
