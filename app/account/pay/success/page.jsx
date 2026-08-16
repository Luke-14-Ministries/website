import Link from 'next/link';
import { getStripe } from '@/lib/stripe/server';
import { dollars } from '@/lib/payments';

export const metadata = { title: 'Payment received' };

// Where Stripe returns the family after checkout. The payment is actually
// recorded by the stripe-webhook Edge Function, not here -- this page just
// confirms and reads the session back to show what happened (including the
// "pending" state a bank transfer is in until it settles).
export default async function PaySuccessPage({ searchParams }) {
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
      /* fall back to the generic message */
    }
  }

  return (
    <section className="bg-brand-light min-h-[60vh] py-14">
      <div className="container-site max-w-md mx-auto">
        <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8 text-center">
          <div className="text-4xl mb-2">{pending ? '⏳' : '✅'}</div>
          <h1 className="text-2xl font-bold mb-3">
            {pending ? 'Payment on its way' : 'Thank you — payment received'}
          </h1>
          <p className="text-neutral-700">
            {amount != null ? (
              <>
                We&rsquo;ve started a payment of <strong>{dollars(amount)}</strong>.{' '}
              </>
            ) : (
              <>Your payment has been started. </>
            )}
            {pending
              ? 'Bank transfers take a few days to clear; it will show as “pending” on your dashboard until it settles, and you don’t need to do anything else.'
              : 'It will appear on your dashboard, and a receipt is on its way.'}
          </p>
          <p className="mt-4 text-xs text-neutral-400">
            Registration payments for camp and other ministry events cover event costs (food,
            lodging, and activities) and are not tax-deductible.
          </p>
          <Link href="/account/dashboard/" className="btn-primary !py-2 mt-6 inline-block">
            Back to my dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
