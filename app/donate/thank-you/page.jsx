import Link from 'next/link';
import { getStripe } from '@/lib/stripe/server';
import { dollars } from '@/lib/payments';

export const metadata = { title: 'Thank you' };

// Where Stripe returns a donor after giving. The gift is recorded by the
// stripe-webhook Edge Function; this page just says thank you and sets
// expectations (including the pending state of a bank-transfer gift).
export default async function DonateThankYouPage({ searchParams }) {
  const params = await searchParams;
  const sessionId = typeof params?.session_id === 'string' ? params.session_id : '';

  let amount = null;
  let pending = false;
  const stripe = getStripe();
  if (stripe && sessionId) {
    try {
      const s = await stripe.checkout.sessions.retrieve(sessionId);
      amount = s.amount_total;
      pending = s.payment_status !== 'paid';
    } catch {
      /* generic message */
    }
  }

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8 text-center">
          <div className="text-4xl mb-2">💛</div>
          <h1 className="text-2xl font-bold mb-3">Thank you for your gift!</h1>
          <p className="text-neutral-700">
            {amount != null ? (
              <>
                Your gift of <strong>{dollars(amount)}</strong>{' '}
                {pending ? 'is on its way' : 'has been received'}.
              </>
            ) : (
              <>Your gift {pending ? 'is on its way' : 'has been received'}.</>
            )}{' '}
            {pending
              ? 'Bank transfers take a few days to clear — nothing more is needed from you.'
              : 'A receipt for your records is on its way to your email.'}
          </p>
          <p className="mt-4 text-neutral-700">
            Your generosity helps families affected by disability find community and
            connection. Thank you for being part of this.
          </p>
          <p className="mt-4 text-xs text-neutral-500">
            Luke 14 Ministries is a registered 501(c)(3) nonprofit (EIN 82-2389397).
            Donations are tax-deductible; no goods or services are provided in exchange
            for this contribution.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/" className="btn-primary !py-2">
              Back to the site
            </Link>
            <Link href="/account/dashboard/" className="btn-outline !py-2">
              My giving history
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
