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
      .select('id, events ( id, name, starts_on, ends_on ), households ( display_name )'),
    supabase
      .from('payments')
      .select('registration_id, amount_cents, fee_cover_cents, method, status, received_on, created_at, note')
      .order('created_at', { ascending: false }),
  ]);

  const regById = new Map((regs ?? []).map((r) => [r.id, r]));

  // Every event that has at least one registration, newest first, for the
  // "Specific event" section of the scope dropdown.
  const evById = new Map();
  for (const r of regs ?? []) if (r.events?.id) evById.set(r.events.id, r.events);
  const eventOptions = [...evById.values()].sort((a, b) =>
    (b.starts_on ?? '').localeCompare(a.starts_on ?? '')
  );

  // Event scope. The dashboard is a quick view of what is coming up (and
  // just wrapped), not a wall of history — old years stay one dropdown
  // selection away under "All events". Scope values:
  //   ''         default: upcoming (next 90 days) + recent (last 90 days)
  //   'upcoming' starts within 90 days or currently running
  //   'recent'   ended within the last 90 days
  //   'all'      full history
  //   <uuid>     one specific event
  const today = new Date().toISOString().slice(0, 10);
  const plus90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const minus90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const inScope = (ev) => {
    if (eventFilter === 'all') return true;
    if (!ev) return !eventFilter; // registrations with no event: default + all only
    const start = ev.starts_on ?? '';
    const end = ev.ends_on ?? ev.starts_on ?? '';
    if (eventFilter === 'upcoming') return end >= today && start <= plus90;
    if (eventFilter === 'recent') return end < today && end >= minus90;
    if (eventFilter) return ev.id === eventFilter;
    return end >= minus90 && start <= plus90;
  };
  const SCOPE_LABEL = {
    '': 'Upcoming & recent events (90 days each way)',
    upcoming: 'Upcoming events (next 90 days)',
    recent: 'Recent events (last 90 days)',
    all: 'All events — full history',
  };
  const scopeLabel = SCOPE_LABEL[eventFilter] ?? evById.get(eventFilter)?.name ?? 'Selected event';

  const events = new Map();
  for (const b of balances ?? []) {
    const ev = regById.get(b.registration_id)?.events;
    if (!inScope(ev)) continue;
    const evName = ev?.name ?? 'Unassigned';
    const cur = events.get(evName) ?? { fees: 0, assist: 0, paid: 0, outstanding: 0 };
    cur.fees += (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
    cur.assist += (b.scholarship_cents ?? 0) + (b.discount_cents ?? 0) + (b.coupon_cents ?? 0);
    cur.paid += b.paid_cents ?? 0;
    cur.outstanding += Math.max(0, b.balance_cents ?? 0);
    events.set(evName, cur);
  }
  const feeCoverTotal = (pays ?? []).reduce(
    (s, p) =>
      s +
      (inScope(regById.get(p.registration_id)?.events) &&
      (p.status === 'succeeded' || p.status === 'processing')
        ? p.fee_cover_cents ?? 0
        : 0),
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
    (b) => matchesPaystate(b) && inScope(regById.get(b.registration_id)?.events)
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
      <p className="text-sm text-neutral-500 mb-4">
        What each family owes and has paid for an event (Camp Celebrate, retreats, and the rest). Online payments record themselves; checks
        and cash are entered below. Donations live on the separate Giving page.
      </p>

      {/* Event scope: governs the cards, fee covers, the balances table,
          and both CSV downloads. Default keeps this a quick view of what's
          coming up; full history is one selection away. */}
      <form method="get" action="/admin/payments" className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <label className="font-semibold text-neutral-700" htmlFor="event-scope">Showing</label>
        <select
          id="event-scope"
          name="event"
          defaultValue={eventFilter}
          className="rounded border border-neutral-300 px-2 py-1"
        >
          <option value="">Upcoming &amp; recent events (90 days each way)</option>
          <option value="upcoming">Upcoming events (next 90 days)</option>
          <option value="recent">Recent events (last 90 days)</option>
          <option value="all">All events — full history</option>
          <optgroup label="Specific event">
            {eventOptions.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </optgroup>
        </select>
        {paystate && <input type="hidden" name="paystate" value={paystate} />}
        <button type="submit" className="btn-outline !py-1 !px-3">Apply</button>
      </form>

      <h3 className="font-semibold text-neutral-700 mb-2">
        By event <span className="font-normal text-sm text-neutral-500">· {scopeLabel}</span>
      </h3>
      {events.size === 0 && (
        <p className="text-sm text-neutral-500 mb-8">
          No events in this window. Choose another option above — &ldquo;All events&rdquo; shows the
          full history.
        </p>
      )}
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
            Voluntarily added by payers to cover processing fees, totaled for the events shown
            above. Never counts toward a family&rsquo;s balance; how it is classified is a
            treasurer decision.
          </p>
        </div>
      </div>

      <h3 className="font-semibold text-neutral-700 mb-2">Balances by family</h3>
      <div className="flex flex-wrap items-center gap-2 mb-3">
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
      {/* Planned global actions — visible placeholders so staff can see
          what is coming (Resend-powered reminders). Per-family actions
          (statement, email, refund) live in each row's ⋯ menu. */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
        <span className="text-neutral-500 font-semibold">Actions:</span>
        {['Email balance reminders (all shown)', 'Email selected families'].map((label) => (
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
        <span className="text-xs text-neutral-400">coming soon</span>
      </div>
      {/* lg:overflow-visible lets the row-actions menu overlay the table
          edge on desktop; small screens keep horizontal scrolling. */}
      <div className="overflow-x-auto lg:overflow-visible rounded-lg border border-neutral-200 bg-white mb-8">
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
                    {bal < 0 ? `−${money(-bal)}` : money(bal)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {/* Per-family actions. <details> = no JavaScript needed;
                        the menu floats over the table, anchored to the ⋯
                        button. Email + Refund are planned placeholders
                        (refunds work in Stripe today). */}
                    <details className="relative inline-block text-left">
                      <summary
                        className="cursor-pointer select-none list-none rounded border border-neutral-300 px-2 py-0.5 font-bold text-neutral-600 hover:border-brand [&::-webkit-details-marker]:hidden"
                        title="Actions for this family"
                      >
                        ⋯
                      </summary>
                      <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-neutral-200 bg-white py-1 text-left text-sm shadow-lg">
                        <a
                          href={`/admin/registrations/${b.registration_id}/statement`}
                          className="block px-3 py-1.5 text-brand hover:bg-neutral-50"
                        >
                          Statement
                        </a>
                        <button
                          type="button"
                          disabled
                          title="Planned — not active yet"
                          className="block w-full cursor-not-allowed px-3 py-1.5 text-left text-neutral-400"
                        >
                          Email balance owed + payment link
                        </button>
                        <button
                          type="button"
                          disabled
                          title="Planned — refunds work in the Stripe dashboard today"
                          className="block w-full cursor-not-allowed px-3 py-1.5 text-left text-neutral-400"
                        >
                          Refund
                        </button>
                      </div>
                    </details>
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
