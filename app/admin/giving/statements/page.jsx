import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from './PrintButton';

export const metadata = { title: 'Giving Statements — Staff Admin' };

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const METHOD_LABEL = {
  card: 'Card',
  bank_transfer: 'Bank transfer',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
};

// Year-end donor statements: one per donor, each on its own printed page, with
// the 501(c)(3) acknowledgment language. Print the whole run in January, or
// narrow to one donor with ?donor=. Date range defaults to the current
// calendar year; ?from/?to override (the Giving page passes its filters
// through). Only settled ("succeeded") gifts appear — a statement is a tax
// document, so clearing money stays off it.
export default async function GivingStatementsPage({ searchParams }) {
  const params = await searchParams;

  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/giving/statements/');
  if (!can(staff, 'giving')) redirect('/admin');

  const year = new Date().getFullYear();
  const from = typeof params?.from === 'string' && params.from ? params.from : `${year}-01-01`;
  const to = typeof params?.to === 'string' && params.to ? params.to : `${year}-12-31`;
  const donorFilter = typeof params?.donor === 'string' ? params.donor.toLowerCase() : '';

  const supabase = await createClient();
  const { data: gifts } = await supabase
    .from('gifts')
    .select('donor_name, email, amount_cents, fund, method, received_on, created_at')
    .eq('status', 'succeeded')
    .order('received_on');

  const giftDate = (g) => g.received_on ?? (g.created_at ?? '').slice(0, 10);
  const inRange = (gifts ?? []).filter((g) => giftDate(g) >= from && giftDate(g) <= to);

  // Group by donor: email is the identity when present, else the name.
  const donors = new Map();
  for (const g of inRange) {
    const key = (g.email ?? g.donor_name ?? 'Unknown donor').toLowerCase();
    if (donorFilter && !key.includes(donorFilter)) continue;
    if (!donors.has(key)) {
      donors.set(key, {
        name: g.donor_name || g.email || 'Unknown donor',
        email: g.email ?? '',
        gifts: [],
        total: 0,
      });
    }
    const d = donors.get(key);
    d.gifts.push(g);
    d.total += g.amount_cents ?? 0;
    if (g.donor_name) d.name = g.donor_name;
  }
  const donorList = [...donors.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0 bg-white text-neutral-900">
      <div className="mb-6 print:hidden">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold">Giving statements — print view</h1>
          <PrintButton />
        </div>
        <p className="text-sm text-neutral-500">
          {donorList.length} {donorList.length === 1 ? 'donor' : 'donors'} · {from} to {to} ·
          each statement prints on its own page. Narrow to one donor by adding{' '}
          <code>?donor=name-or-email</code> to the address. Only settled gifts are included.
        </p>
        <p className="text-sm">
          <a href="/admin/giving" className="text-brand underline">
            ← Back to Giving
          </a>
        </p>
      </div>

      {donorList.length === 0 && (
        <p className="text-neutral-500">No settled gifts in this date range.</p>
      )}

      {donorList.map((d, di) => (
        <div key={di} className="mb-10 break-after-page">
          {/* Letterhead */}
          <div className="border-b-2 border-neutral-800 pb-3 mb-5">
            <p className="text-2xl font-bold">Luke 14 Ministries</p>
            <p className="text-sm text-neutral-600">
              2348 W Andrew Johnson Hwy, #140 · Morristown, TN 37814 ·
              giving@luke14ministries.net
            </p>
          </div>

          <div className="flex flex-wrap justify-between gap-4 mb-4 text-sm">
            <div>
              <p className="font-bold">{d.name}</p>
              {d.email && <p className="text-neutral-600">{d.email}</p>}
            </div>
            <div className="text-right">
              <p className="font-bold">Giving statement</p>
              <p className="text-neutral-600">
                {from} – {to}
              </p>
            </div>
          </div>

          <table className="w-full text-sm border-collapse mb-3">
            <thead>
              <tr className="text-left border-b border-neutral-400">
                <th className="py-1 pr-3">Date</th>
                <th className="py-1 pr-3">Designated to</th>
                <th className="py-1 pr-3">Method</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.gifts.map((g, i) => (
                <tr key={i} className="border-b border-neutral-200">
                  <td className="py-1 pr-3">{giftDate(g)}</td>
                  <td className="py-1 pr-3">{g.fund}</td>
                  <td className="py-1 pr-3">{METHOD_LABEL[g.method] ?? g.method}</td>
                  <td className="py-1 text-right">{money(g.amount_cents)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="py-2 font-bold">
                  Total
                </td>
                <td className="py-2 text-right font-bold">{money(d.total)}</td>
              </tr>
            </tbody>
          </table>

          <p className="text-sm text-neutral-700 mb-2">
            Thank you for your generosity. Your support helps families affected by disability
            find community and connection.
          </p>
          <p className="text-xs text-neutral-500">
            Luke 14 Ministries is a registered 501(c)(3) tax-exempt organization (EIN
            82-2389397). No goods or services were provided in exchange for these
            contributions. Please retain this statement for your tax records.
          </p>
        </div>
      ))}
    </div>
  );
}
