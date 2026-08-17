import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import RecordPaymentForm from './RecordPaymentForm';

export const metadata = { title: 'Event Payments — Staff Admin' };

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const METHOD_LABEL = {
  card: 'Card',
  bank_transfer: 'Bank transfer',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
};
const STATUS_CLS = {
  pending: 'bg-neutral-100 text-neutral-600',
  processing: 'bg-amber-100 text-amber-800',
  succeeded: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  refunded: 'bg-neutral-200 text-neutral-600',
};

// Event money only (Camp Celebrate, retreats, dinners...). Donations live on the separate Giving page, behind their
// own permission -- reconciling camp fees does not require seeing who gave
// what. Registrar-gated; RLS is the backstop.
export default async function AdminPaymentsPage({ searchParams }) {
  const params = await searchParams;
  const paystate = typeof params?.paystate === 'string' ? params.paystate : '';
  const eventFilter = typeof params?.event === 'string' ? params.event : '';

  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/payments/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();

  const [{ data: balances }, { data: regs }, { data: pays }] = await Promise.all([
    supabase
      .from('registration_balances')
      .select('registration_id, event_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents'),
    supabase
      .from('registrations')
      .select('id, events ( id, name ), households ( display_name )'),
    supabase
      .from('payments')
      .select('registration_id, amount_cents, fee_cover_cents, method, status, received_on, created_at, note')
      .order('created_at', { ascending: false }),
  ]);

  const regById = new Map((regs ?? []).map((r) => [r.id, r]));

  // Every event that has at least one registration, for the filter dropdown.
  const eventOptions = [...new Map(
    (regs ?? [])
      .filter((r) => r.events?.id)
      .map((r) => [r.events.id, r.events.name])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const events = new Map();
  for (const b of balances ?? []) {
    const evName = regById.get(b.registration_id)?.events?.name ?? 'Unassigned';
    const cur = events.get(evName) ?? { fees: 0, assist: 0, paid: 0, outstanding: 0 };
    cur.fees += (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
    cur.assist += (b.scholarship_cents ?? 0) + (b.discount_cents ?? 0) + (b.coupon_cents ?? 0);
    cur.paid += b.paid_cents ?? 0;
    cur.outstanding += Math.max(0, b.balance_cents ?? 0);
    events.set(evName, cur);
  }
  const feeCoverTotal = (pays ?? []).reduce(
    (s, p) => s + (p.status === 'succeeded' || p.status === 'processing' ? p.fee_cover_cents ?? 0 : 0),
    0
  );

  const regOptions = (balances ?? []).map((b) => {
    const r = regById.get(b.registration_id);
    return {
      id: b.registration_id,
      label: `${r?.households?.display_name ?? 'Household'} — ${r?.events?.name ?? ''} (balance ${money(b.balance_cents)})`,
    };
  });

  // Payment-state filter for the balances table + CSV. Definitions:
  //   unpaid  = owes something, nothing received
  //   partial = something received, balance remains
  //   paid    = balance settled (payments incl. clearing bank transfers)
  //   scholarship = any scholarship or discount applied
  const matchesPaystate = (b) => {
    const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
    const paid = b.paid_cents ?? 0;
    const bal = b.balance_cents ?? 0;
    switch (paystate) {
      case 'unpaid':
        return paid === 0 && bal > 0;
      case 'partial':
        return paid > 0 && bal > 0;
      case 'paid':
        return net > 0 && bal <= 0;
      case 'scholarship':
        return (b.scholarship_cents ?? 0) > 0 || (b.discount_cents ?? 0) > 0;
      default:
        return true;
    }
  };
  const filteredBalances = (balances ?? []).filter(
    (b) => matchesPaystate(b) && (!eventFilter || b.event_id === eventFilter)
  );
  const PAYSTATES = [
    ['', 'All'],
    ['unpaid', 'Nothing paid'],
    ['partial', 'Partially paid'],
    ['paid', 'Fully paid'],
    ['scholarship', 'Scholarship/discount'],
  ];
  // One helper builds every filter-carrying URL (pills, CSVs) so the active
  // event + payment state always travel together.
  const qs = (over = {}) => {
    const p = new URLSearchParams();
    const ps = 'paystate' in over ? over.paystate : paystate;
    const ev = 'event' in over ? over.event : eventFilter;
    if (ps) p.set('paystate', ps);
    if (ev) p.set('event', ev);
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const csvHref = `/admin/exports/payments${qs()}`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Event Payments</h2>
        <span className="flex gap-2">
          <a
            href={`/admin/exports/balances${qs()}`}
            className="btn-outline !py-2 text-sm"
            title="One row per family: fees, scholarships, paid, balance"
          >
            Balances CSV
          </a>
          <a href={csvHref} className="btn-outline !py-2 text-sm" title="One row per payment received">
            Payments CSV
          </a>
        </span>
      </div>
      <p className="text-sm text-neutral-500 mb-6">
        What each family owes and has paid for an event (Camp Celebrate, retreats, and the rest). Online payments record themselves; checks
        and cash are entered below. Donations live on the separate Giving page.
      </p>

      <h3 className="font-semibold text-neutral-700 mb-2">By event</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {[...events.entries()].map(([name, e]) => (
          <div key={name} className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
            <h4 className="font-bold mb-2">{name}</h4>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between"><dt className="text-neutral-500">Fees (net of assistance)</dt><dd className="font-semibold">{money(e.fees)}</dd></div>
              {e.assist > 0 && (
                <div className="flex justify-between"><dt className="text-neutral-500">Scholarships &amp; discounts</dt><dd className="font-semibold text-green-700">−{money(e.assist)}</dd></div>
              )}
              <div className="flex justify-between"><dt className="text-neutral-500">Paid / clearing</dt><dd className="font-semibold text-green-700">{money(e.paid)}</dd></div>
              <div className="flex justify-between"><dt className="text-neutral-500">Outstanding</dt><dd className="font-semibold text-amber-700">{money(e.outstanding)}</dd></div>
            </dl>
          </div>
        ))}
        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
          <h4 className="font-bold mb-2">Fee covers</h4>
          <div className="text-2xl font-bold">{money(feeCoverTotal)}</div>
          <p className="text-xs text-neutral-500 mt-1">
            Voluntarily added by payers to cover processing fees. Never counts toward a family&rsquo;s
            balance; how it is classified is a treasurer decision.
          </p>
        </div>
      </div>

      <h3 className="font-semibold text-neutral-700 mb-2">Balances by family</h3>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Event filter: narrows the table AND both CSV downloads, so a
            simplified report never requires filtering in Excel. */}
        <form method="get" action="/admin/payments" className="flex items-center gap-2">
          {paystate && <input type="hidden" name="paystate" value={paystate} />}
          <select
            name="event"
            defaultValue={eventFilter}
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">All events</option>
            {eventOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <button type="submit" className="btn-outline !py-1 !px-3 text-sm">Apply</button>
        </form>
        {PAYSTATES.map(([v, label]) => (
          <Link
            key={v}
            href={`/admin/payments${qs({ paystate: v })}`}
            className={`rounded-full px-3 py-1 text-sm font-semibold border ${
              paystate === v
                ? 'bg-brand text-white border-brand'
                : 'border-neutral-300 text-neutral-700 hover:border-brand'
            }`}
          >
            {label}
          </Link>
        ))}
        <span className="text-sm text-neutral-500 self-center">
          {filteredBalances.length} {filteredBalances.length === 1 ? 'family' : 'families'}
        </span>
      </div>
      {/* Planned actions — visible placeholders so staff can see what is
          coming. Wire these up before enabling: email reminders (Resend),
          in-app refund recording (Stripe refunds already work from the
          Stripe dashboard today; this will record them here too). */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
        <span className="text-neutral-500 font-semibold">Actions:</span>
        {['Email balance reminders (all shown)', 'Email selected families', 'Record a refund'].map((label) => (
          <button
            key={label}
            type="button"
            disabled
            title="Planned — not active yet"
            className="cursor-not-allowed rounded border border-dashed border-neutral-300 px-3 py-1 text-neutral-400"
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-neutral-400">coming soon — refunds work in the Stripe dashboard today</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white mb-8">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Household</th>
              <th className="px-4 py-2 font-semibold">Event</th>
              <th className="px-4 py-2 font-semibold text-right">Fees</th>
              <th className="px-4 py-2 font-semibold text-right">Scholarship / discount</th>
              <th className="px-4 py-2 font-semibold text-right">Paid</th>
              <th className="px-4 py-2 font-semibold text-right">Balance</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {filteredBalances.map((b) => {
              const r = regById.get(b.registration_id);
              const assist = (b.discount_cents ?? 0) + (b.scholarship_cents ?? 0) + (b.coupon_cents ?? 0);
              const bal = b.balance_cents ?? 0;
              return (
                <tr key={b.registration_id} className="border-t border-neutral-100">
                  <td className="px-4 py-2">
                    <Link href={`/admin/registrations/${b.registration_id}`} className="text-brand underline font-medium">
                      {r?.households?.display_name ?? 'Household'}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r?.events?.name ?? ''}</td>
                  <td className="px-4 py-2 text-right">{money(b.fee_cents)}</td>
                  <td className="px-4 py-2 text-right text-green-700">
                    {assist > 0 ? `−${money(assist)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{money(b.paid_cents)}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${bal > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                    {bal < 0 ? `Credit −${money(-bal)}` : money(bal)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <a
                      href={`/admin/registrations/${b.registration_id}/statement`}
                      className="text-brand underline text-xs"
                    >
                      Statement
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold text-neutral-700 mb-2">Record a payment &amp; recent activity</h3>
      <div className="grid gap-6 lg:grid-cols-2">
        <RecordPaymentForm registrations={regOptions} />

        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h4 className="font-bold mb-3">Recent activity</h4>
          {(pays ?? []).length === 0 ? (
            <p className="text-neutral-500 text-sm">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {(pays ?? []).slice(0, 15).map((p, i) => {
                const r = regById.get(p.registration_id);
                return (
                  <li key={i} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-medium">{r?.households?.display_name ?? 'Household'}</span>{' '}
                      <span className="text-neutral-500">
                        · {p.received_on ?? (p.created_at || '').slice(0, 10)} · {METHOD_LABEL[p.method] ?? p.method}
                      </span>
                      <br />
                      <span className="font-semibold">{money(p.amount_cents)}</span>
                      {(p.fee_cover_cents ?? 0) > 0 && (
                        <span className="text-neutral-500"> + {money(p.fee_cover_cents)} fee cover</span>
                      )}
                    </span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[p.status] ?? ''}`}>
                      {p.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
