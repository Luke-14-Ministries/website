import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import RecordPaymentForm from './RecordPaymentForm';
import RecordGiftForm from './RecordGiftForm';

export const metadata = { title: 'Payments — Staff Admin' };

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

// The money view: what each family owes and has paid, per camp week, plus the
// fee-cover total (kept separate -- it never counts toward a balance), and the
// form for recording checks and cash. Registrar-gated; RLS is the backstop.
export default async function AdminPaymentsPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/payments/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();

  const [{ data: balances }, { data: regs }, { data: pays }, { data: gifts }] = await Promise.all([
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
    supabase
      .from('gifts')
      .select('donor_name, email, amount_cents, fund, method, status, received_on, created_at')
      .order('created_at', { ascending: false }),
  ]);

  const regById = new Map((regs ?? []).map((r) => [r.id, r]));

  // Per-event rollup.
  const events = new Map();
  for (const b of balances ?? []) {
    const evName = regById.get(b.registration_id)?.events?.name ?? 'Unassigned';
    const cur = events.get(evName) ?? { fees: 0, paid: 0, outstanding: 0 };
    cur.fees += (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
    cur.paid += b.paid_cents ?? 0;
    cur.outstanding += Math.max(0, b.balance_cents ?? 0);
    events.set(evName, cur);
  }
  const feeCoverTotal = (pays ?? []).reduce(
    (s, p) => s + (p.status === 'succeeded' || p.status === 'processing' ? p.fee_cover_cents ?? 0 : 0),
    0
  );

  // Options for the manual-payment form, labelled by family + week + balance.
  const regOptions = (balances ?? []).map((b) => {
    const r = regById.get(b.registration_id);
    return {
      id: b.registration_id,
      label: `${r?.households?.display_name ?? 'Household'} — ${r?.events?.name ?? ''} (balance ${money(b.balance_cents)})`,
    };
  });

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Payments</h2>
      <p className="text-sm text-neutral-500 mb-6">
        What each family owes and has paid. Online payments record themselves; checks and cash
        are entered below.
      </p>

      {/* Per-week money summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {[...events.entries()].map(([name, e]) => (
          <div key={name} className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
            <h3 className="font-bold mb-2">{name}</h3>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between"><dt className="text-neutral-500">Fees (net)</dt><dd className="font-semibold">{money(e.fees)}</dd></div>
              <div className="flex justify-between"><dt className="text-neutral-500">Paid / clearing</dt><dd className="font-semibold text-green-700">{money(e.paid)}</dd></div>
              <div className="flex justify-between"><dt className="text-neutral-500">Outstanding</dt><dd className="font-semibold text-amber-700">{money(e.outstanding)}</dd></div>
            </dl>
          </div>
        ))}
        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
          <h3 className="font-bold mb-2">Fee covers</h3>
          <div className="text-2xl font-bold">{money(feeCoverTotal)}</div>
          <p className="text-xs text-neutral-500 mt-1">
            Voluntarily added by payers to cover processing fees. Never counts toward a family&rsquo;s
            balance; how it is classified is a treasurer decision.
          </p>
        </div>
      </div>

      {/* Per-registration balances */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white mb-8">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Household</th>
              <th className="px-4 py-2 font-semibold">Week</th>
              <th className="px-4 py-2 font-semibold text-right">Fees (net)</th>
              <th className="px-4 py-2 font-semibold text-right">Paid</th>
              <th className="px-4 py-2 font-semibold text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(balances ?? []).map((b) => {
              const r = regById.get(b.registration_id);
              const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
              return (
                <tr key={b.registration_id} className="border-t border-neutral-100">
                  <td className="px-4 py-2">
                    <Link href={`/admin/registrations/${b.registration_id}`} className="text-brand underline font-medium">
                      {r?.households?.display_name ?? 'Household'}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r?.events?.name ?? ''}</td>
                  <td className="px-4 py-2 text-right">{money(net)}</td>
                  <td className="px-4 py-2 text-right">{money(b.paid_cents)}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${(b.balance_cents ?? 0) > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                    {money(b.balance_cents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- Giving ---- */}
      <h2 className="text-xl font-bold mb-1 mt-2">Giving</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Donations, kept separate from camp payments (gifts are tax-deductible; camp payments are
        not). Online gifts record themselves; mailed checks are entered below.
      </p>
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        {(() => {
          const good = (gifts ?? []).filter((g) => g.status === 'succeeded' || g.status === 'processing');
          const total = good.reduce((s, g) => s + (g.amount_cents ?? 0), 0);
          const byFund = new Map();
          for (const g of good) byFund.set(g.fund, (byFund.get(g.fund) ?? 0) + (g.amount_cents ?? 0));
          return (
            <>
              <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
                <div className="text-2xl font-bold">{money(total)}</div>
                <div className="text-sm text-neutral-500">Total gifts (incl. clearing)</div>
              </div>
              <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
                <div className="text-2xl font-bold">{good.length}</div>
                <div className="text-sm text-neutral-500">Gifts recorded</div>
              </div>
              <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
                <div className="text-sm font-semibold mb-1">By fund</div>
                {byFund.size === 0 ? (
                  <p className="text-sm text-neutral-500">No gifts yet.</p>
                ) : (
                  <ul className="text-sm space-y-0.5">
                    {[...byFund.entries()].map(([f, c]) => (
                      <li key={f} className="flex justify-between">
                        <span className="text-neutral-600">{f}</span>
                        <span className="font-semibold">{money(c)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          );
        })()}
      </div>
      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        <RecordGiftForm />
        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h3 className="font-bold mb-3">Recent gifts</h3>
          {(gifts ?? []).length === 0 ? (
            <p className="text-neutral-500 text-sm">No gifts yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {(gifts ?? []).slice(0, 12).map((g, i) => (
                <li key={i} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium">{g.donor_name || g.email || 'Anonymous'}</span>{' '}
                    <span className="text-neutral-500">
                      · {g.received_on ?? (g.created_at || '').slice(0, 10)} · {g.fund}
                    </span>
                    <br />
                    <span className="font-semibold">{money(g.amount_cents)}</span>
                    <span className="text-neutral-500"> · {METHOD_LABEL[g.method] ?? g.method}</span>
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLS[g.status] ?? ''}`}>
                    {g.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <h2 className="text-xl font-bold mb-4">Camp payment entry & activity</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <RecordPaymentForm registrations={regOptions} />

        {/* Recent payments */}
        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h3 className="font-bold mb-3">Recent payments</h3>
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
