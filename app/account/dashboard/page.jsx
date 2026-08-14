import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getStaff } from '@/lib/staff';

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

  // The household this login belongs to, with its members. RLS returns only the
  // caller's household, so we take the first (a login has one).
  const { data: households } = await supabase
    .from('households')
    .select('id, display_name, people ( id, first_name, last_name, date_of_birth )');
  const household = households?.[0] ?? null;
  const members = household?.people ?? [];

  // Registrations for this household, newest first, with the event and each
  // participant. RLS scopes this to the caller automatically.
  const { data: registrations } = await supabase
    .from('registrations')
    .select(
      `id, family_notes, created_at,
       events ( name, starts_on, ends_on ),
       registration_participants ( camp_role, status, fee_cents,
         people ( first_name, last_name ) )`
    )
    .order('created_at', { ascending: false });

  const regs = registrations ?? [];

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

        {/* Staff door -- only when this login is also active staff. */}
        {staff && (
          <div className="mb-8 rounded-lg border border-brand/30 bg-brand-light p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-brand-dark">You also have staff access</p>
              <p className="text-sm text-neutral-600">
                This page is your own family view. The staff area is where you see everyone —{' '}
                {staff.title || staff.role}
                {staff.can_view_sensitive ? ', with sensitive access' : ''}.
              </p>
            </div>
            <Link href="/admin" className="btn-primary !py-2 shrink-0">
              Go to Staff Area
            </Link>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Registrations -- real */}
          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6 lg:col-span-2">
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
                      <div className="mt-4 flex flex-wrap gap-3">
                        <SoonButton>Pay Balance</SoonButton>
                        <SoonButton>Edit Registration</SoonButton>
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
          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
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
              <SoonButton>Manage Household</SoonButton>
            </div>
          </div>

          {/* Giving -- not built yet; show an honest empty state, not fake numbers */}
          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6 lg:col-span-2">
            <h2 className="text-xl font-bold mb-4">My Giving</h2>
            <p className="text-neutral-500">
              Online giving isn&rsquo;t live yet. Once it is, your giving history and
              receipts will appear here.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <SoonButton>Manage Recurring Gift</SoonButton>
              <SoonButton>Download Giving Statement</SoonButton>
            </div>
          </div>

          {/* Account settings -- change password works today */}
          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
            <h2 className="text-xl font-bold mb-4">Account Settings</h2>
            <ul className="space-y-2 text-neutral-700">
              <li className="text-neutral-400">Update contact information</li>
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
              <li className="text-neutral-400">Email preferences</li>
              <li className="text-neutral-400">Payment methods</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
