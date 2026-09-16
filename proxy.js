// Runs on every matching request, before the page does.
//
// All it does is call updateSession, which refreshes the Supabase login
// cookie and redirects anonymous visitors away from the signed-in area. The
// reasoning lives in lib/supabase/middleware.js.
//
// This file must sit at the repository root, beside package.json. Next.js
// finds it by location, not by import -- move it into app/ or lib/ and it
// silently stops running, with no error anywhere.
//
// WHY THIS FILE IS CALLED proxy.js AND NOT middleware.js
//
// It was middleware.js until 16 September 2026. Next.js 16 renamed the
// convention: the file is proxy.js and the exported function is `proxy`.
// The old name still loads in 16 but is deprecated, and the point of the
// upgrade was to stop carrying deprecated things. Nothing about what it does
// changed. Older comments and DECISIONS.md entries that say "the middleware"
// mean this file; the helper it calls kept its name because that name is
// ours, not a Next.js convention.
//
// One consequence worth knowing: `proxy` always runs on the Node.js runtime.
// The old middleware ran on the Edge runtime. That is fine here -- nothing in
// updateSession needed Edge, and Node has crypto.subtle -- but it means a
// future reader should not expect Edge-runtime limits (or speed) from it.

import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next's own build output, the favicon, and image files.
    // Those are static assets: running an auth check on them would mean an
    // extra network round-trip to Supabase for every logo on every page.
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
