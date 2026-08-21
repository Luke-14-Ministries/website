import Link from 'next/link';

export const metadata = { title: 'Link Expired' };

// Where the auth callback and the /auth/confirm button page send anyone whose
// emailed link did not work. Since 21 Aug 2026 there are only two ways to get
// here: the link was already used, or it expired (about an hour). The old
// third cause -- "opened in a different browser than the one that signed up"
// -- was the PKCE device-binding bug, fixed by the switch to the implicit
// flow; do not resurrect that wording, it sends people chasing a cause that
// no longer exists.
export default function LinkExpiredPage() {
  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8">
          <h1 className="text-3xl font-bold mb-3">That link didn&rsquo;t work</h1>
          <p className="text-neutral-700">
            Email links work once and expire after about an hour. This one has
            already been used, or its hour has passed.
          </p>
          {/* Try logging in FIRST, and it is the primary button below. The
              most common way to land here is a link something already spent
              -- a second press of the confirm button, or a mail scanner that
              got past the button page. In those cases the account IS
              confirmed; only this browser lacks a session, and logging in
              just works. Genuinely expired links fall through to the second
              button. */}
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
            {/* 4953 is Larry (CEO), who handles account/platform help; 4954 is
                the camp director and remains the general ministry line in the
                footer. Confirmed 21 Aug 2026 -- don't "fix" this to match. */}
            <a href="tel:+14237484953" className="text-brand underline">
              (423) 748-4953
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
