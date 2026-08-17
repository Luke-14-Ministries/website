import { notFound, redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from './PrintButton';

export const metadata = { title: 'Family Statement — Staff Admin' };

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

const METHOD_LABEL = {
  card: 'Card',
  bank_transfer: 'Bank transfer',
  check: 'Check',
  cash: 'Cash',
  other: 'Other',
};

// A printable, family-friendly statement for one registration: fees itemized
// per person, scholarships and discounts shown plainly, every payment listed,
// and the balance. What staff print and hand (or mail) to a family.
export default async function FamilyStatementPage({ params }) {
  const { id } = await params;

  const staff = await getStaff();
  if (!staff) redirect(`/account/?next=/admin/registrations/${id}/statement/`);
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();

  const [{ data: reg }, { data: pays }, { data: bal }] = await Promise.all([
    supabase
      .from('registrations')
      .select(
        `id,
         households ( display_name, email, phone, address_line1, address_line2, city, state, postal_code ),
         events ( name, starts_on, ends_on ),
         registration_participants ( camp_role, status, fee_cents, scholarship_cents, discount_cents,
           people ( first_name, last_name ) )`
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('payments')
      .select('amount_cents, fee_cover_cents, method, status, received_on, created_at')
      .eq('registration_id', id)
      .order('created_at'),
    supabase
      .from('registration_balances')
      .select('fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents')
      .eq('registration_id', id)
      .maybeSingle(),
  ]);

  if (!reg) notFound();

  const h = reg.households ?? {};
  const parts = (reg.registration_participants ?? []).filter((p) => p.status !== 'cancelled');
  const goodPays = (pays ?? []).filter((p) => p.status === 'succeeded' || p.status === 'processing');
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="mx-auto max-w-2xl p-8 print:p-0 bg-white print:text-[12px] text-neutral-900">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h1 className="text-xl font-bold">Family statement — print view</h1>
        <PrintButton />
      </div>

      {/* Letterhead */}
      <div className="border-b-2 border-neutral-800 pb-3 mb-5 flex flex-wrap items-end justify-between gap-3">
        <img
          src="/images/Luke_14_Ministries_Logo__285_x_2_in_29.png"
          alt="Luke 14 Ministries"
          className="h-16 w-auto"
        />
        <p className="text-sm text-neutral-600 text-right">
          2348 W Andrew Johnson Hwy, #140 · Morristown, TN 37814
          <br />
          camp@luke14ministries.net
        </p>
      </div>

      <div className="flex flex-wrap justify-between gap-4 mb-6 text-sm">
        <div>
          <p className="font-bold">{h.display_name}</p>
          {(h.address_line1 || h.city) && (
            <p className="text-neutral-600">
              {[h.address_line1, h.address_line2].filter(Boolean).join(', ')}
              <br />
              {[h.city, h.state, h.postal_code].filter(Boolean).join(', ')}
            </p>
          )}
          {h.email && <p className="text-neutral-600">{h.email}</p>}
        </div>
        <div className="text-right">
          <p className="font-bold">Statement</p>
          <p className="text-neutral-600">{today}</p>
          <p className="text-neutral-600">
            {reg.events?.name}
            <br />
            {reg.events?.starts_on} – {reg.events?.ends_on}
          </p>
        </div>
      </div>

      {/* Charges */}
      <table className="w-full text-sm border-collapse mb-4">
        <thead>
          <tr className="text-left border-b border-neutral-400">
            <th className="py-1 pr-3">Person</th>
            <th className="py-1 pr-3">Role</th>
            <th className="py-1 text-right">Fee</th>
            <th className="py-1 text-right">Scholarship</th>
            <th className="py-1 text-right">Discount</th>
            <th className="py-1 text-right">Due</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p, i) => {
            const due =
              (p.fee_cents ?? 0) - (p.scholarship_cents ?? 0) - (p.discount_cents ?? 0);
            return (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-1 pr-3 font-medium">
                  {p.people?.first_name} {p.people?.last_name}
                </td>
                <td className="py-1 pr-3">{ROLE_LABEL[p.camp_role] ?? p.camp_role}</td>
                <td className="py-1 text-right">{money(p.fee_cents)}</td>
                <td className="py-1 text-right">
                  {(p.scholarship_cents ?? 0) > 0 ? `−${money(p.scholarship_cents)}` : '—'}
                </td>
                <td className="py-1 text-right">
                  {(p.discount_cents ?? 0) > 0 ? `−${money(p.discount_cents)}` : '—'}
                </td>
                <td className="py-1 text-right font-semibold">{money(due)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Payments */}
      <p className="font-bold text-sm mb-1">Payments received</p>
      {goodPays.length === 0 ? (
        <p className="text-sm text-neutral-500 mb-4">No payments yet.</p>
      ) : (
        <table className="w-full text-sm border-collapse mb-4">
          <thead>
            <tr className="text-left border-b border-neutral-400">
              <th className="py-1 pr-3">Date</th>
              <th className="py-1 pr-3">Method</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {goodPays.map((p, i) => (
              <tr key={i} className="border-b border-neutral-200">
                <td className="py-1 pr-3">{p.received_on ?? (p.created_at || '').slice(0, 10)}</td>
                <td className="py-1 pr-3">{METHOD_LABEL[p.method] ?? p.method}</td>
                <td className="py-1 pr-3">
                  {p.status === 'processing' ? 'clearing the bank' : 'received'}
                </td>
                <td className="py-1 text-right">{money(p.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Totals */}
      <div className="ml-auto w-64 text-sm mb-8">
        <div className="flex justify-between py-1">
          <span>Fees</span>
          <span>{money(bal?.fee_cents)}</span>
        </div>
        {(bal?.scholarship_cents ?? 0) > 0 && (
          <div className="flex justify-between py-1 text-green-700">
            <span>Scholarships</span>
            <span>−{money(bal?.scholarship_cents)}</span>
          </div>
        )}
        {(bal?.discount_cents ?? 0) > 0 && (
          <div className="flex justify-between py-1 text-green-700">
            <span>Discounts</span>
            <span>−{money(bal?.discount_cents)}</span>
          </div>
        )}
        {(bal?.coupon_cents ?? 0) > 0 && (
          <div className="flex justify-between py-1 text-green-700">
            <span>Coupons</span>
            <span>−{money(bal?.coupon_cents)}</span>
          </div>
        )}
        <div className="flex justify-between py-1">
          <span>Payments</span>
          <span>−{money(bal?.paid_cents)}</span>
        </div>
        <div className="flex justify-between py-2 border-t-2 border-neutral-800 font-bold text-base">
          <span>{(bal?.balance_cents ?? 0) < 0 ? 'Credit' : 'Balance due'}</span>
          <span>{money(Math.abs(bal?.balance_cents ?? 0))}</span>
        </div>
        {(bal?.balance_cents ?? 0) < 0 && (
          <p className="text-xs text-neutral-500 pt-1">
            This family has paid more than the amount due. The credit can be refunded or applied
            to a future event.
          </p>
        )}
      </div>

      <p className="text-xs text-neutral-500">
        Registration payments for camp and other ministry events cover event costs (food, lodging,
        and activities) and are not tax-deductible. Payments marked &ldquo;clearing the bank&rdquo;
        are counted above and finish settling within a few days. Questions? Email
        camp@luke14ministries.net or call (423) 748-4954.
      </p>
    </div>
  );
}
