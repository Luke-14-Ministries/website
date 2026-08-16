import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import RecordGiftForm from './RecordGiftForm';

export const metadata = { title: 'Giving — Staff Admin' };

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

// Donor giving records -- deliberately a SEPARATE page from camp payments,
// behind its own permission (can_view_giving; admins implicitly). A registrar
// reconciling camp fees has no need to see who gave what. RLS (migration 0010)
// is the real gate; this check just gives a friendly redirect.
export default async function AdminGivingPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/giving/');
  if (!can(staff, 'giving')) redirect('/admin');

  const supabase = await createClient();
  const { data: gifts } = await supabase
    .from('gifts')
    .select('donor_name, email, amount_cents, fund, method, status, received_on, created_at, note')
    .order('created_at', { ascending: false });

  const all = gifts ?? [];
  const good = all.filter((g) => g.status === 'succeeded' || g.status === 'processing');
  const total = good.reduce((s, g) => s + (g.amount_cents ?? 0), 0);
  const byFund = new Map();
  for (const g of good) byFund.set(g.fund, (byFund.get(g.fund) ?? 0) + (g.amount_cents ?? 0));

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Giving</h2>
      <p className="text-sm text-neutral-500 mb-6">
        Donations — tax-deductible, and kept fully separate from camp payments (which are not).
        Access to this page is its own permission. Online gifts record themselves; mailed checks
        and cash are entered below.
      </p>

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
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
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecordGiftForm />

        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h3 className="font-bold mb-3">Recent gifts</h3>
          {all.length === 0 ? (
            <p className="text-neutral-500 text-sm">No gifts yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {all.slice(0, 15).map((g, i) => (
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
    </div>
  );
}
