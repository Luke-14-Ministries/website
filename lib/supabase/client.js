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
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
