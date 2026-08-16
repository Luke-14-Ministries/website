import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import AdminNav from './AdminNav';

export const metadata = { title: 'Staff Admin — Luke 14 Ministries' };

// The full planned admin structure, gated by role. `ready: false` items show as
// greyed placeholders so the shape of the system (and the access model) is visible
// while the pages get built one at a time.
// A plain-language description of what each role can do, shown in the header so
// a staff member always knows which "hat" they are wearing and what it grants.
const ROLE_INFO = {
  admin: {
    label: 'Administrator',
    blurb: 'Full access — registrations, rosters, settings, staff, and two-factor resets.',
  },
  registrar: {
    label: 'Registrar',
    blurb: 'Registrations, rosters, and (soon) payments.',
  },
  coordinator: {
    label: 'Coordinator',
    blurb: 'Activities and buddy assignments.',
  },
};

// group: 'events' items live inside the collapsible "Events" section of the
// sidebar; ungrouped items render at the top (before) or bottom (after) level.
const NAV = [
  { href: '/admin', label: 'Overview', need: 'staff', ready: true },
  { href: '/admin/rosters', label: 'Rosters', need: 'registrar', ready: true, group: 'events' },
  { href: '/admin/checkin', label: 'Check-In', need: 'door', ready: true, group: 'events' },
  { href: '/admin/changes', label: 'Recent Changes', need: 'registrar', ready: true, group: 'events' },
  { href: '/admin/dietary', label: 'Dietary & Allergies', need: 'sensitive', ready: true, group: 'events' },
  { href: '/admin/medical', label: 'Medical & Support', need: 'sensitive', ready: true, group: 'events' },
  { href: '/admin/volunteers', label: 'Volunteers', need: 'registrar', ready: false, group: 'events' },
  { href: '/admin/activities', label: 'Activities', need: 'coordinator', ready: false, group: 'events' },
  { href: '/admin/buddies', label: 'Buddy Assignments', need: 'coordinator', ready: false, group: 'events' },
  { href: '/admin/payments', label: 'Event Payments', need: 'registrar', ready: true, group: 'events' },
  { href: '/admin/giving', label: 'Giving', need: 'giving', ready: true },
  { href: '/admin/setup', label: 'Setup', need: 'admin', ready: false },
  { href: '/admin/security', label: 'Two-Factor Resets', need: 'admin', ready: true },
  { href: '/admin/staff', label: 'Staff & Access', need: 'admin', ready: true },
];

export default async function AdminLayout({ children }) {
  const staff = await getStaff();
  // Not staff (or not signed in) -> bounce to login, then back here.
  if (!staff) redirect('/account/?next=/admin/');

  // Staff must have two-factor turned on before they can open the staff area,
  // because everything in here is other families' information. getAuthenticator-
  // AssuranceLevel reports nextLevel === 'aal2' exactly when a verified factor
  // exists; anything else means no factor, so send them to set one up. This is
  // an enrolment gate, not a per-visit challenge -- the login form is what asks
  // for the code each time a staffer with a factor signs in.
  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel !== 'aal2') {
    redirect('/account/security?required=1');
  }

  // The person's own name, so the header shows clearly WHO is signed in --
  // not just their role and email.
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', staff.userId)
    .maybeSingle();
  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    staff.email;

  const items = NAV.filter((n) => can(staff, n.need));

  // A small attention dot on "Recent Changes" when unreviewed family edits
  // exist. Count only -- cheap head query; RLS scopes what this staffer may
  // count (support-detail rows stay invisible without the sensitive grant).
  let unreviewedChanges = 0;
  if (can(staff, 'registrar')) {
    const { count } = await supabase
      .from('family_change_log')
      .select('id', { count: 'exact', head: true })
      .is('reviewed_at', null);
    unreviewedChanges = count ?? 0;
  }

  return (
    <section className="bg-neutral-50 min-h-[70vh]">
      <div className="container-site py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              Staff Admin{' '}
              <span className="text-brand">
                [{(ROLE_INFO[staff.role] ?? {}).label ?? staff.role}
                {staff.can_view_sensitive ? ' · Sensitive access' : ''}]
              </span>
            </h1>
            <p className="text-sm text-neutral-700 mt-1">
              Signed in as <span className="font-semibold">{fullName}</span> · {staff.email}
            </p>
            <p className="text-xs text-neutral-500 mt-0.5">
              {(ROLE_INFO[staff.role] ?? {}).blurb ?? 'Staff access.'}
              {staff.can_view_sensitive ? ' Plus medical & support details.' : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-neutral-700 hidden sm:inline">{fullName}</span>
            <Link href="/account/dashboard/" className="btn-outline !py-1.5 text-sm">
              My Account
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <AdminNav
            top={items.filter((n) => !n.group && n.href === '/admin')}
            events={items.filter((n) => n.group === 'events')}
            rest={items.filter((n) => !n.group && n.href !== '/admin')}
            unreviewedChanges={unreviewedChanges}
          />

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
