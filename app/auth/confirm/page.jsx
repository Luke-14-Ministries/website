import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/site';

export const metadata = { title: 'Confirm' };

// The landing page for emailed links -- and the reason it exists is that it
// does NOT confirm anything by itself.
//
// THE PROBLEM THIS SOLVES
//
// An emailed link gets requested by more than the person it was sent to.
// Outlook's SafeLinks, spam filters, antivirus, and browser preloading all
// follow URLs to see where they lead -- and with the old design, where the
// link itself performed the confirmation, "following the URL" was enough to
// spend the one-time token. The auth log for 20 Aug 2026 shows the signature:
// a successful /verify, then "One-time token not found" one second later. The
// scanner got there first; the person's real click was the second request and
// landed on an error page.
//
// THE FIX
//
// Scanners send GET requests. They do not fill in forms. So the email link
// (a GET) lands here, on a page that renders a button and spends nothing.
// The button submits a form (a POST) to the server action below, and THAT is
// what verifies the token. A scanner can fetch this page a hundred times and
// the token is still unspent when the person arrives.
//
// The old /auth/callback route still exists and still works -- emails sent
// before the templates changed point there, and it also serves any future
// flow that arrives with a ?code=. New emails should point HERE; the Supabase
// email templates (dashboard -> Authentication -> Emails) are what decide.

async function confirmAction(formData) {
  'use server';

  const tokenHash = formData.get('token_hash');
  const type = formData.get('type');
  // Path-only: never redirect off-site. See safeNextPath in lib/site.js.
  const next = safeNextPath(formData.get('next'));

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) redirect(next);
  }

  // Same courtesy as the callback route: if a duplicate submit from this
  // browser already spent the token, the session it created is on this
  // request -- check before showing an error page.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next);

  redirect('/account/link-expired/');
}

export default async function ConfirmPage({ searchParams }) {
  const params = await searchParams;
  const tokenHash = params?.token_hash ?? '';
  const type = params?.type ?? 'email';

  // The signup form passes its onward destination inside the redirect URL
  // (?next=/register/family/). The email template forwards that whole URL to
  // us as ?redirect_to=. Dig the path back out; anything unexpected falls
  // back to the dashboard.
  let next = type === 'recovery' ? '/account/reset-password/' : '/account/dashboard/';
  const redirectTo = params?.redirect_to;
  if (typeof redirectTo === 'string') {
    try {
      const embedded = new URL(redirectTo).searchParams.get('next');
      if (embedded) next = safeNextPath(embedded, next);
    } catch {
      /* not a URL -- keep the default */
    }
  }

  // No token in the URL at all: someone typed the address by hand, or a mail
  // client mangled the link. Nothing to verify, nothing to show but the door.
  if (!tokenHash) redirect('/account/link-expired/');

  const isRecovery = type === 'recovery';

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8 text-center">
          <h1 className="text-3xl font-bold mb-3">
            {isRecovery ? 'Reset your password' : 'Confirm your email address'}
          </h1>
          <p className="text-neutral-700 mb-6">
            {isRecovery
              ? 'Click the button to continue to the password reset form.'
              : 'One more click and your account is ready.'}
          </p>
          <form action={confirmAction}>
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="next" value={next} />
            <button type="submit" className="btn-primary w-full">
              {isRecovery ? 'Continue to password reset' : 'Confirm my email address'}
            </button>
          </form>
          <p className="mt-5 text-sm text-neutral-500">
            Didn&rsquo;t expect this email? You can safely ignore it &mdash;
            nothing happens unless the button is clicked.
          </p>
        </div>
      </div>
    </section>
  );
}
