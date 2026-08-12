import Link from 'next/link';

export const metadata = { title: 'Link Expired' };

// Where app/auth/callback/route.js sends anyone whose emailed link did not
// work. Expired, already used, or opened in a different browser from the one
// that asked for it -- all ordinary, none of them worth an error code.
export default function LinkExpiredPage() {
  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8">
          <h1 className="text-3xl font-bold mb-3">That link didn&rsquo;t work</h1>
          <p className="text-neutral-700">
            Email links can only be used once, and they expire after a while.
            This one has already been used, has run out, or was opened in a
            different browser from the one you signed up in.
          </p>
          {/* Try logging in FIRST, and it is the primary button below.
              When a confirmation link is opened in a different browser, the
              account has in fact already been confirmed -- Supabase verifies
              the token on its own servers before redirecting here, so
              email_confirmed_at is set. The only thing that failed was handing
              THIS browser a session. Sending someone to request another link
              would fail identically; sending them to log in just works.
              Genuinely expired links fall through to the second button. */}
          <p className="mt-4 text-neutral-700">
            Nothing is lost, and your account is safe. <strong>Try logging in
            first</strong> — if you were confirming a new account, it is very
            likely already confirmed and your password will get you straight in.
          </p>
          <p className="mt-4 text-neutral-700">
            If that doesn&rsquo;t work, request a new link and it will arrive in
            a minute or two.
          </p>
          <p className="mt-4 text-neutral-600 text-sm">
            If it keeps happening, email{' '}
            <a
              href="mailto:info@luke14ministries.net"
              className="text-brand underline break-words"
            >
              info@luke14ministries.net
            </a>{' '}
            or call{' '}
            <a href="tel:+14237484954" className="text-brand underline">
              (423) 748-4954
            </a>{' '}
            and we&rsquo;ll get you in.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/account" className="btn-primary !py-2">
              Log In
            </Link>
            <Link href="/account/forgot-password" className="btn-outline !py-2">
              Send a New Link
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
