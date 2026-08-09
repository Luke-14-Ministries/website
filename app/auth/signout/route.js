// Logging out.
//
// This is a POST, and the Log Out control is a real form rather than a link,
// on purpose. A GET link that logs you out can be fired by anything that can
// make the browser fetch a URL -- an image tag in an email, a link on another
// site -- which is how people end up mysteriously logged out mid-registration.
//
// signOut() revokes the refresh token at Supabase and clears the cookies, so
// the session is dead server-side too, not just forgotten locally.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await supabase.auth.signOut();
  }

  const { origin } = new URL(request.url);
  // 303 tells the browser to follow up with a GET. Without it, some browsers
  // re-POST to the destination.
  return NextResponse.redirect(`${origin}/account/`, { status: 303 });
}
