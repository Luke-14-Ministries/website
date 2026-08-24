'use client';

// The page a visitor sees when client-side code throws. Without this file,
// Next.js shows one unstyled line -- "Application error: a client-side
// exception has occurred" -- which is exactly what a tester hit on 24 Aug
// after an ACH attempt. That crash had the signature of a deployment landing
// mid-session (a refresh fixed it), which is also why the primary button here
// is a FULL reload: it pulls the current build, which for that whole class of
// failure is the cure.
//
// Written for this site's actual audience: a parent mid-registration, not a
// developer. No stack traces, no jargon, a reassurance that their work is
// saved (writes happen server-side on save -- a rendering crash does not
// undo them), and two ways forward.

import Link from 'next/link';

export default function Error({ error, reset }) {
  return (
    <section className="bg-neutral-50 min-h-[60vh] py-16">
      <div className="container-site max-w-lg mx-auto text-center">
        <h1 className="text-3xl font-bold">Something went wrong on this page</h1>
        <p className="mt-4 text-neutral-700">
          Sorry about that — the page hit a problem while displaying. Anything you had
          already saved is safe.
        </p>
        <p className="mt-2 text-neutral-700">
          Refreshing almost always fixes this, especially if the site was just updated.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            Refresh the page
          </button>
          <Link href="/account/dashboard/" className="btn-outline">
            Go to my dashboard
          </Link>
        </div>
        <p className="mt-8 text-sm text-neutral-500">
          Still stuck? Email info@luke14ministries.net and tell us what you were doing —
          we&rsquo;ll sort it out.
        </p>
      </div>
    </section>
  );
}
