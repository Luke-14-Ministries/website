import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getStaff } from '@/lib/staff';
import PayPanel from './PayPanel';

export const metadata = { title: 'Dashboard' };

// Age is derived from date of birth against today -- never stored (a stored age
// goes stale silently). Returns null when no DOB is on file.
function ageFrom(dob) {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const had =
    now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!had) age -= 1;
  return age;
}

const money = (cents) =>
  `$${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

const STATUS = {
  draft: ['Draft', 'bg-neutral-100 text-neutral-700'],
  submitted: ['Submitted — pending review', 'bg-amber-100 text-amber-800'],
  waitlisted: ['Waitlisted', 'bg-orange-100 text-orange-800'],
  confirmed: ['Confirmed', 'bg-green-100 text-green-800'],
  cancelled: ['Cancelled', 'bg-neutral-200 text-neutral-500'],
};

const STAFF_ROLE_LABEL = {
  admin: 'Administrator',
  registrar: 'Registrar',
  coordinator: 'Coordinator',
};

// A disabled "coming soon" button, so the dashboard never shows a control that
// silently does nothing.
function SoonButton({ children }) {
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      className="btn-outline !py-2 opacity-40 cursor-not-allowed"
    >
      {children}
    </button>
  );
}

// Server component: the queries run on the server as the logged-in family, and
// row-level security guarantees these can only ever return this household's own
// rows -- so what renders here is real data, scoped to them.
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/account/?next=/account/dashboard/');

  // The same login may also be staff. This is the one-account design: staff are
  // ordinary accounts flagged in public.staff, not a separate login. When that
  // is true we surface a clear door into the staff area -- and the staff area
  // links back here -- so a person who is both a parent and a volunteer (or
  // registrar) always knows which "hat" they are wearing. Their family view
  // (here) still shows only their own household; the staff view shows everyone.
  const staff = await getStaff();

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', user.id)
    .maybeSingle();

  const greeting =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    user.email;

  // Which household(s) this login actually BELONGS to, by membership. This
  // scoping is essential for the one-account design: staff RLS can read every
  // family's rows, so a bare query here would show a staff member other
  // families' data on their own personal dashboard. Membership keeps the
  // family hat and the staff hat separate.
  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  const householdIds = (memberships ?? []).map((m) => m.household_id);

  const { data: households } = householdIds.length
    ? await supabase
        .from('households')
        .select('id, display_name, people ( id, first_name, last_name, date_of_birth )')
        .in('id', householdIds)
    : { data: [] };
  const household = households?.[0] ?? null;
  const members = household?.people ?? [];

  // Registrations for this household, newest first, with the event and each
  // participant.
  const { data: registrations } = householdIds.length
    ? await supabase
        .from('registrations')
        .select(
          `id, family_notes, created_at,
           events ( id, name, starts_on, ends_on, deposit_cents ),
           registration_participants ( id, camp_role, status, fee_cents,
             people ( first_name, last_name ) )`
        )
        .in('household_id', householdIds)
        .order('created_at', { ascending: false })
    : { data: [] };

  const regs = registrations ?? [];
  const regIds = regs.map((r) => r.id);

  // Short notes from staff TO the family, per registration (0019), shown on
  // each registration card. Scoped by regIds (own household's registrations).
  const { data: staffMsgs } = regIds.length
    ? await supabase
        .from('registration_family_messages')
        .select('registration_id, body, created_at')
        .in('registration_id', regIds)
        .order('created_at', { ascending: false })
    : { data: [] };
  const msgsByReg = new Map();
  for (const m of staffMsgs ?? []) {
    if (!msgsByReg.has(m.registration_id)) msgsByReg.set(m.registration_id, []);
    msgsByReg.get(m.registration_id).push(m);
  }

  // Registered volunteers who haven't filed their volunteer application yet —
  // surfaced as a nudge below, because the application is a separate short
  // form at /register/volunteer and is easy to miss.
  const volunteerParts = regs.flatMap((r) =>
    (r.registration_participants ?? []).filter(
      (p) => p.camp_role === 'volunteer' && p.status !== 'cancelled'
    )
  );
  let volunteersNeedingApp = [];
  if (volunteerParts.length) {
    const { data: vapps } = await supabase
      .from('volunteer_applications')
      .select('registration_participant_id, status')
      .in('registration_participant_id', volunteerParts.map((p) => p.id));
    const appStatus = new Map((vapps ?? []).map((a) => [a.registration_participant_id, a.status]));
    volunteersNeedingApp = volunteerParts.filter(
      (p) => !appStatus.has(p.id) || appStatus.get(p.id) === 'withdrawn'
    );
  }

  // What each registration still owes, computed by the registration_balances
  // view (fees minus discounts, scholarships, coupons and payments already in).
  const { data: balances } = regIds.length
    ? await supabase
        .from('registration_balances')
        .select('registration_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents')
        .in('registration_id', regIds)
    : { data: [] };
  const balByReg = new Map((balances ?? []).map((b) => [b.registration_id, b]));
  const balanceByReg = new Map((balances ?? []).map((b) => [b.registration_id, b.balance_cents]));

  // Every payment on this household's registrations, newest first. Shown as a
  // history under each registration, so "what have we paid and has it
  // cleared?" never needs a phone call.
  const { data: paymentRows } = regIds.length
    ? await supabase
        .from('payments')
        .select('registration_id, amount_cents, fee_cover_cents, method, status, received_on, created_at')
        .in('registration_id', regIds)
        .order('created_at', { ascending: false })
    : { data: [] };
  const paymentsByReg = new Map();
  for (const p of paymentRows ?? []) {
    if (!paymentsByReg.has(p.registration_id)) paymentsByReg.set(p.registration_id, []);
    paymentsByReg.get(p.registration_id).push(p);
  }
  // Money currently mid-flight (a bank transfer that hasn't settled). The
  // balance view already counts it as paid; the UI says "clearing" instead of
  // "paid" so the two states never get confused.
  const pendingByReg = new Map();
  for (const p of paymentRows ?? []) {
    if (p.status === 'processing') {
      pendingByReg.set(
        p.registration_id,
        (pendingByReg.get(p.registration_id) ?? 0) + (p.amount_cents ?? 0)
      );
    }
  }

  // This person's own giving history. The explicit profile filter matters:
  // staff can read ALL gifts under RLS, but "My Giving" must only ever show
  // their own -- even for an administrator wearing their family hat.
  const { data: giftRows } = await supabase
    .from('gifts')
    .select('amount_cents, fund, method, status, received_on, created_at')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: false });
  const myGifts = giftRows ?? [];
  const givenTotal = myGifts
    .filter((g) => g.status === 'succeeded' || g.status === 'processing')
    .reduce((s, g) => s + (g.amount_cents ?? 0), 0);

  // Adaptive layout: most of the ministry's supporters are donors, not camp
  // families (contributions are ~84% of revenue on the 2024 Form 990). A
  // donor with no registrations gets a giving-first dashboard; a camp family
  // sees registrations first. One login, emphasis to match the person.
  const donorFirst = regs.length === 0 && myGifts.length > 0;

  const PAY_METHOD_LABEL = {
    card: 'Card',
    bank_transfer: 'Bank transfer',
    check: 'Check',
    cash: 'Cash',
    other: 'Other',
  };
  const PAY_STATUS = {
    pending: ['Started', 'bg-neutral-100 text-neutral-600'],
    processing: ['Clearing the bank', 'bg-amber-100 text-amber-800'],
    succeeded: ['Received', 'bg-green-100 text-green-800'],
    failed: ['Failed — not received', 'bg-red-100 text-red-800'],
    refunded: ['Refunded', 'bg-neutral-200 text-neutral-600'],
  };
  const payDate = (p) => (p.received_on ?? (p.created_at || '').slice(0, 10)) || '';

  return (
    <section className="bg-neutral-50 min-h-[70vh] py-12">
      <div className="container-site">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Welcome back, {greeting}!</h1>
            <p className="text-neutral-500">Signed in as {user.email}</p>
          </div>
          {/* A form, not a link. See app/auth/signout/route.js for why. */}
          <form action="/auth/signout/" method="post">
            <button type="submit" className="btn-outline !py-2">
              Log Out
            </button>
          </form>
        </div>

        {volunteersNeedingApp.length > 0 && (
          <div className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-amber-900">
                Additional volunteer details needed for{' '}
                {volunteersNeedingApp
                  .map((p) => `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim())
                  .join(', ')}
              </p>
              <p className="text-sm text-amber-800">
                Your registration is in — a few more questions tell us where you&rsquo;d like to
                serve, and start the volunteer review.
              </p>
            </div>
            <Link href="/register/volunteer" className="btn-primary !py-2">
              Complete it now
            </Link>
          </div>
        )}

        {/* Staff door -- only when this login is also active staff. */}
        {staff && (
          <div className="mb-8 rounded-lg border border-brand/30 bg-brand-light p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-brand-dark">
                You also have staff access{' '}
                <span className="text-neutral-700">
                  [{staff.title || STAFF_ROLE_LABEL[staff.role] || staff.role}
                  {staff.can_view_sensitive ? ' · Sensitive access' : ''}]
                </span>
              </p>
              <p className="text-sm text-neutral-600">
                This page is your own family view; the staff area is where you see everyone.
              </p>
            </div>
            <Link href="/admin" className="btn-primary !py-2 shrink-0">
              Go to Staff Area
            </Link>
          </div>
        )}

        {/* items-start keeps each card hugging its own content instead of
            stretching to its row's tallest neighbor (no empty white space). */}
        <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
          {/* Registrations -- real */}
          <div className={`rounded-lg bg-white border border-neutral-200 shadow-sm p-6 lg:col-span-2 ${donorFirst ? 'order-3' : 'order-1'}`}>
            <h2 className="text-xl font-bold mb-4">My Camp Registrations</h2>

            {regs.length === 0 ? (
              <div className="rounded border border-dashed border-neutral-300 p-6 text-center text-neutral-600">
                <p>You haven&rsquo;t registered anyone yet.</p>
                <Link href="/register/family" className="btn-primary !py-2 mt-4 inline-block">
                  Start a Registration
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {regs.map((r) => {
                  const parts = r.registration_participants ?? [];
                  const total = parts.reduce((s, p) => s + (p.fee_cents ?? 0), 0);
                  return (
                    <div key={r.id} className="rounded border border-neutral-200 p-4">
                      <div className="flex flex-wrap justify-between gap-3">
                        <p className="font-semibold">{r.events?.name ?? 'Camp registration'}</p>
                        <span className="text-neutral-600 text-sm">
                          {parts.length} {parts.length === 1 ? 'person' : 'people'} · Total {money(total)}
                        </span>
                      </div>
                      <ul className="mt-3 divide-y divide-neutral-100">
                        {parts.map((p, i) => {
                          const [label, cls] = STATUS[p.status] ?? STATUS.submitted;
                          return (
                            <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                              <span>
                                {p.people?.first_name} {p.people?.last_name}
                                <span className="text-neutral-500"> — {ROLE_LABEL[p.camp_role] ?? p.camp_role}</span>
                              </span>
                              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
                                {label}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {r.family_notes && (
                        <p className="mt-3 text-sm text-neutral-600">
                          <span className="font-semibold">Notes to staff:</span> {r.family_notes}
                        </p>
                      )}

                      {/* Notes FROM camp staff — e.g. "We added a $100
                          scholarship credit to your registration on 8/17." */}
                      {(msgsByReg.get(r.id) ?? []).length > 0 && (
                        <div className="mt-3 rounded border border-brand/30 bg-brand-light/50 p-3">
                          <p className="text-sm font-semibold text-brand-dark mb-1">
                            Notes from camp staff
                          </p>
                          <ul className="space-y-1 text-sm text-neutral-700">
                            {(msgsByReg.get(r.id) ?? []).map((m, i) => (
                              <li key={i}>
                                {m.body}{' '}
                                <span className="text-xs text-neutral-500">
                                  · {(m.created_at ?? '').slice(0, 10)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Payment history: every payment on this registration, with
                          its status -- including any fee-cover amount, recorded
                          separately because it never counts toward the balance. */}
                      {(paymentsByReg.get(r.id) ?? []).length > 0 && (
                        <div className="mt-4 rounded border border-neutral-100 bg-neutral-50 p-3">
                          <p className="text-sm font-semibold mb-2">Payments</p>
                          <ul className="divide-y divide-neutral-100 text-sm">
                            {(paymentsByReg.get(r.id) ?? []).map((p, i) => {
                              const [label, cls] = PAY_STATUS[p.status] ?? PAY_STATUS.pending;
                              return (
                                <li
                                  key={i}
                                  className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                                >
                                  <span className="text-neutral-700">
                                    {payDate(p)} · {PAY_METHOD_LABEL[p.method] ?? p.method} ·{' '}
                                    <span className="font-semibold">{money(p.amount_cents)}</span>
                                    {(p.fee_cover_cents ?? 0) > 0 && (
                                      <span className="text-neutral-500">
                                        {' '}
                                        + {money(p.fee_cover_cents)} fee cover
                                      </span>
                                    )}
                                  </span>
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}
                                  >
                                    {label}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {(() => {
                        const b = balByReg.get(r.id);
                        if (!b) return null;
                        const reductions =
                          (b.scholarship_cents ?? 0) + (b.discount_cents ?? 0) + (b.coupon_cents ?? 0);
                        if (reductions === 0) return null;
                        const bal = b.balance_cents ?? 0;
                        return (
                          <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm max-w-xs">
                            <div className="flex justify-between py-0.5">
                              <span className="text-neutral-500">Fees</span>
                              <span>{money(b.fee_cents)}</span>
                            </div>
                            {(b.scholarship_cents ?? 0) > 0 && (
                              <div className="flex justify-between py-0.5 text-green-700">
                                <span>Scholarship</span>
                                <span>−{money(b.scholarship_cents)}</span>
                              </div>
                            )}
                            {(b.discount_cents ?? 0) > 0 && (
                              <div className="flex justify-between py-0.5 text-green-700">
                                <span>Discount</span>
                                <span>−{money(b.discount_cents)}</span>
                              </div>
                            )}
                            {(b.coupon_cents ?? 0) > 0 && (
                              <div className="flex justify-between py-0.5 text-green-700">
                                <span>Coupon</span>
                                <span>−{money(b.coupon_cents)}</span>
                              </div>
                            )}
                            <div className="flex justify-between py-0.5">
                              <span className="text-neutral-500">Paid</span>
                              <span>−{money(b.paid_cents)}</span>
                            </div>
                            <div className="flex justify-between py-0.5 border-t border-neutral-200 font-semibold">
                              <span>{bal < 0 ? 'Credit' : 'Balance'}</span>
                              <span className={bal < 0 ? 'text-green-700' : bal > 0 ? 'text-amber-700' : ''}>
                                {bal < 0 ? `−${money(-bal)}` : money(bal)}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <PayPanel
                          registrationId={r.id}
                          balanceCents={balanceByReg.get(r.id)}
                          depositCents={r.events?.deposit_cents}
                          pendingCents={pendingByReg.get(r.id)}
                        />
                        <Link
                          href={`/register/family/?event=${r.events?.id ?? ''}`}
                          title="Opens your saved registration so you can make changes."
                          className="btn-outline !py-2"
                        >
                          Edit Registration
                        </Link>
                        <Link
                          href={`/account/statement/${r.id}`}
                          title="A printable statement: fees, scholarships, payments, and balance."
                          className="btn-outline !py-2"
                        >
                          Statement
                        </Link>
                      </div>
                    </div>
                  );
                })}
                <Link href="/register/family" className="btn-outline !py-2 inline-block">
                  New Registration
                </Link>
              </div>
            )}
          </div>

          {/* Household -- real */}
          <div className={`rounded-lg bg-white border border-neutral-200 shadow-sm p-6 ${donorFirst ? 'order-4' : 'order-2'}`}>
            <h2 className="text-xl font-bold mb-4">My Household</h2>
            {members.length === 0 ? (
              <p className="text-neutral-500">
                No family members on file yet. They&rsquo;re added when you register.
              </p>
            ) : (
              <ul className="space-y-2 text-neutral-700">
                {members.map((m) => {
                  const age = ageFrom(m.date_of_birth);
                  return (
                    <li key={m.id}>
                      {m.first_name} {m.last_name}
                      <span className="text-neutral-500">
                        {age != null ? ` (age ${age})` : ' (no DOB provided)'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-4">
              <Link href="/account/household/" className="btn-outline !py-2 inline-block">
                Manage Household
              </Link>
            </div>
          </div>

          {/* Giving -- real history, giving-first for donors */}
          <div className={`rounded-lg bg-white border border-neutral-200 shadow-sm p-6 lg:col-span-2 ${donorFirst ? 'order-1' : 'order-3'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h2 className="text-xl font-bold">My Giving</h2>
              {givenTotal > 0 && (
                <span className="text-sm text-neutral-600">
                  Total given: <strong>{money(givenTotal)}</strong>
                </span>
              )}
            </div>

            {myGifts.length === 0 ? (
              <p className="text-neutral-500">
                No gifts on record for this account yet. When you give online while logged
                in, your gifts and receipts appear here.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 text-sm mb-2">
                {myGifts.map((g, i) => {
                  const [label, cls] = PAY_STATUS[g.status] ?? PAY_STATUS.pending;
                  return (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="text-neutral-700">
                        {(g.received_on ?? (g.created_at || '').slice(0, 10)) || ''} ·{' '}
                        <span className="font-semibold">{money(g.amount_cents)}</span>
                        <span className="text-neutral-500"> — {g.fund}</span>
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-3 text-sm text-neutral-600">
              Luke 14 Ministries is a registered <strong>501(c)(3)</strong> nonprofit
              organization, and <strong>donations are tax-deductible</strong> to the extent
              allowed by law. (Event registration payments — camp, retreats, and the like — are not; they cover
              event costs such as food, lodging, and activities.)
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {/* Same destination as the header's Donate button, and that is
                  deliberate: this one completes the giving card's story ("your
                  history, and here is where a new gift goes"), while the header
                  button serves people anywhere on the site. One consistent
                  label, logged in or not, donor or not. */}
              <Link href="/donate" className="btn-gold !py-2">
                Make a New Gift
              </Link>
              <SoonButton>Manage Recurring Gift</SoonButton>
              <SoonButton>Download Giving Statement</SoonButton>
            </div>
          </div>

          {/* Account settings -- change password works today */}
          <div className={`rounded-lg bg-white border border-neutral-200 shadow-sm p-6 ${donorFirst ? 'order-2' : 'order-4'}`}>
            <h2 className="text-xl font-bold mb-4">My Account Settings</h2>
            <ul className="space-y-2 text-neutral-700">
              <li>
                <Link href="/account/contact" className="text-brand underline">
                  Update contact information
                </Link>
              </li>
              <li>
                <Link href="/account/reset-password" className="text-brand underline">
                  Change password
                </Link>
              </li>
              <li>
                <Link href="/account/security" className="text-brand underline">
                  Two-factor authentication
                </Link>
              </li>
              <li>
                <Link href="/account/contact#email-preferences" className="text-brand underline">
                  Email preferences
                </Link>
              </li>
              <li className="text-neutral-400" title="Coming with recurring giving">
                Payment methods
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
