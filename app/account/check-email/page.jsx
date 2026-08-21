import Link from 'next/link';

export const metadata = { title: 'Check Your Email' };

// Shown straight after signing up. The account exists at this point but
// cannot be used until the address is confirmed, which is what stops someone
// registering a family under an address they do not own.
export default async function CheckEmailPage({ searchParams }) {
  // In Next.js 15 searchParams is a promise. Awaiting it is not optional.
  const params = await searchParams;
  const email = typeof params?.email === 'string' ? params.email : '';

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8">
          <h1 className="text-3xl font-bold mb-3">Check your email</h1>
          <p className="text-neutral-700">
            We&rsquo;ve sent a confirmation link
            {email ? (
              <>
                {' '}
                to <strong className="break-words">{email}</strong>
              </>
            ) : null}
            . Open it to finish setting up your account and continue to
            registration.
          </p>
          <p className="mt-4 text-neutral-600 text-sm">
            The link works once and expires after about an hour, so it&rsquo;s
            best to open it now. If it doesn&rsquo;t arrive within a few
            minutes, <strong>check your spam or junk folder</strong> &mdash;
            new senders often land there at first.
          </p>
          {/* The "Not junk" ask is not boilerplate — it is the single most
              effective thing a recipient can do for our deliverability.
              Marking Not junk + adding the sender to contacts trains their
              provider's filter, and enough of those signals raises the
              sending domain's reputation for everyone after them. */}
          <p className="mt-4 text-neutral-600 text-sm">
            If it&rsquo;s in spam: mark it <strong>&ldquo;Not junk&rdquo;</strong>{' '}
            and add{' '}
            <strong className="break-words">registration@luke14ministries.net</strong>{' '}
            to your contacts or safe senders. That keeps our emails &mdash;
            receipts, reminders, statements &mdash; out of spam for good.
          </p>
          {/* Deliberately a mailto and a phone number rather than a link to the
              contact form. Someone reading this page is stuck outside their
              account; sending them to a form to fill in is the wrong answer
              even when the form works. Give them a person. */}
          <p className="mt-4 text-neutral-600 text-sm">
            Still nothing? Email us at{' '}
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
            and we&rsquo;ll sort it out with you.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/account" className="btn-outline !py-2">
              Back to Log In
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
