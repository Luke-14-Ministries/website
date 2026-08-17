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
export default async function AdminGivingPage({ searchParams }) {
  const params = await searchParams;
  const fFrom = typeof params?.from === 'string' ? params.from : '';
  const fTo = typeof params?.to === 'string' ? params.to : '';
  const fFund = typeof params?.fund === 'string' ? params.fund : '';
  const fMethod = typeof params?.method === 'string' ? params.method : '';

  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/giving/');
  if (!can(staff, 'giving')) redirect('/admin');

  const supabase = await createClient();
  const { data: gifts } = await supabase
    .from('gifts')
    .select('donor_name, email, amount_cents, fund, method, status, received_on, created_at, note')
    .order('created_at', { ascending: false });

  // Filter by date (received_on, falling back to created date), fund, method.
  // Totals below reflect the filtered set, and the CSV carries the same filters.
  const giftDate = (g) => g.received_on ?? (g.created_at || '').slice(0, 10);
  const allGifts = gifts ?? [];
  const fundOptions = [...new Set(allGifts.map((g) => g.fund).filter(Boolean))].sort();
  const all = allGifts.filter(
    (g) =>
      (!fFrom || giftDate(g) >= fFrom) &&
      (!fTo || giftDate(g) <= fTo) &&
      (!fFund || g.fund === fFund) &&
      (!fMethod || g.method === fMethod)
  );
  const csvParams = new URLSearchParams();
  if (fFrom) csvParams.set('from', fFrom);
  if (fTo) csvParams.set('to', fTo);
  if (fFund) csvParams.set('fund', fFund);
  if (fMethod) csvParams.set('method', fMethod);
  const csvQs = csvParams.toString();
  const csvHref = `/admin/exports/giving${csvQs ? `?${csvQs}` : ''}`;
  const good = all.filter((g) => g.status === 'succeeded' || g.status === 'processing');
  const total = good.reduce((s, g) => s + (g.amount_cents ?? 0), 0);
  const byFund = new Map();
  for (const g of good) byFund.set(g.fund, (byFund.get(g.fund) ?? 0) + (g.amount_cents ?? 0));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Giving</h2>
        <a href={csvHref} className="btn-outline !py-2 text-sm">
          Download CSV
        </a>
      </div>
      <p className="text-sm text-neutral-500 mb-6">
        Donations — tax-deductible, and kept fully separate from camp payments (which are not).
        Access to this page is its own permission. Online gifts record themselves; mailed checks
        and cash are entered below.
      </p>

      {/* Plain GET form: works with no JavaScript, and the URL becomes a
          shareable/bookmarkable report ("gifts to the camp fund this quarter"). */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-lg bg-white border border-neutral-200 p-4">
        <label className="block text-sm">
          <span className="block font-semibold mb-1">From</span>
          <input type="date" name="from" defaultValue={fFrom} className="rounded border border-neutral-300 px-2 py-1.5" />
        </label>
        <label className="block text-sm">
          <span className="block font-semibold mb-1">To</span>
          <input type="date" name="to" defaultValue={fTo} className="rounded border border-neutral-300 px-2 py-1.5" />
        </label>
        <label className="block text-sm">
          <span className="block font-semibold mb-1">Fund</span>
          <select name="fund" defaultValue={fFund} className="rounded border border-neutral-300 px-2 py-1.5 bg-white">
            <option value="">All funds</option>
            {fundOptions.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="block font-semibold mb-1">Method</span>
          <select name="method" defaultValue={fMethod} className="rounded border border-neutral-300 px-2 py-1.5 bg-white">
            <option value="">All methods</option>
            {Object.entries(METHOD_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary !py-1.5 text-sm">Apply</button>
        {(fFrom || fTo || fFund || fMethod) && (
          <a href="/admin/giving" className="text-sm text-neutral-500 underline">Clear</a>
        )}
        <a
          href={`/admin/giving/statements${csvQs ? `?${csvQs}` : ''}`}
          className="btn-outline !py-1.5 text-sm ml-auto"
        >
          Year-end statements
        </a>
      </form>

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
              {all.slice(0, 50).map((g, i) => (
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
