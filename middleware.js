// Middleware runs on every matching request, before the page does.
//
// All it does is call updateSession, which refreshes the Supabase login
// cookie and redirects anonymous visitors away from the signed-in area. The
// reasoning lives in lib/supabase/middleware.js.
//
// This file must sit at the repository root, beside package.json. Next.js
// finds it by location, not by import -- move it into app/ or lib/ and it
// silently stops running, with no error anywhere.

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next's own build output, the favicon, and image files.
    // Those are static assets: running an auth check on them would mean an
    // extra network round-trip to Supabase for every logo on every page.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
