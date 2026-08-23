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
    blurb:
      'Full access — registrations, rosters, settings, accounts, and two-factor resets; can grant or revoke any staff role, administrator included.',
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
  { href: '/admin/volunteers', label: 'Volunteers', need: 'registrar', ready: true, group: 'events' },
  { href: '/admin/activities', label: 'Activities', need: 'coordinator', ready: false, group: 'events' },
  { href: '/admin/buddies', label: 'Buddy Assignments', need: 'coordinator', ready: false, group: 'events' },
  { href: '/admin/payments', label: 'Event Payments', need: 'registrar', ready: true, group: 'events' },
  { href: '/admin/giving', label: 'Giving', need: 'giving', ready: true },
  { href: '/admin/setup', label: 'Setup', need: 'admin', ready: true },
  // Accounts subsumes the old Two-Factor Resets page: the same reset lives in
  // each row's menu, without typing an email address. /admin/security still
  // works by URL as a fallback if the table itself is ever the thing broken.
  { href: '/admin/accounts', label: 'Accounts', need: 'admin', ready: true },
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
  let volunteersAwaiting = 0;
  let recentAccounts = 0;
  if (can(staff, 'admin')) {
    // Accounts created in the last 7 days -- the same amber treatment as the
    // review queues, so a burst of new signups is visible from any admin page.
    const { data: n } = await supabase.rpc('admin_recent_account_count', { p_days: 7 });
    recentAccounts = n ?? 0;
  }
  if (can(staff, 'registrar')) {
    const [{ count: changesCount }, { count: volCount }] = await Promise.all([
      supabase
        .from('family_change_log')
        .select('id', { count: 'exact', head: true })
        .is('reviewed_at', null),
      // Applications sitting in "applied" — same treatment as Recent
      // Changes: a number on the nav whenever something needs review.
      supabase
        .from('volunteer_applications')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'applied'),
    ]);
    unreviewedChanges = changesCount ?? 0;
    volunteersAwaiting = volCount ?? 0;
  }

  return (
    <section className="bg-neutral-50 min-h-[70vh] print:bg-white">
      <div className="container-site py-8 print:p-0 print:max-w-none">
        {/* Header, tidied 23 Aug. It previously said the person's name twice,
            repeated a "My Account" link the site nav already carries, and led
            with the ACCESS LEVEL as the headline. The dashboard leads with the
            person; this now matches -- name first, what they can do second,
            spelled out once each. */}
        <div className="mb-6 print:hidden">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Staff Admin
          </p>
          <h1 className="text-2xl font-bold">{fullName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-brand-light text-brand-dark px-2.5 py-0.5 text-xs font-semibold">
              {(ROLE_INFO[staff.role] ?? {}).label ?? staff.role}
            </span>
            {staff.can_view_sensitive && (
              <span className="rounded-full bg-neutral-200 text-neutral-700 px-2.5 py-0.5 text-xs font-semibold">
                Sensitive access
              </span>
            )}
            {staff.can_view_giving && (
              <span className="rounded-full bg-neutral-200 text-neutral-700 px-2.5 py-0.5 text-xs font-semibold">
                Giving
              </span>
            )}
            <span className="text-xs text-neutral-500">{staff.email}</span>
          </div>
          <p className="text-xs text-neutral-500 mt-1.5">
            {(ROLE_INFO[staff.role] ?? {}).blurb ?? 'Staff access.'}
            {staff.can_view_sensitive ? ' Plus medical & support details.' : ''}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[220px_1fr] print:block">
          <div className="print:hidden">
            <AdminNav
            top={items.filter((n) => !n.group && n.href === '/admin')}
            events={items.filter((n) => n.group === 'events')}
            rest={items.filter((n) => !n.group && n.href !== '/admin')}
            badges={{
              '/admin/changes': unreviewedChanges,
              '/admin/volunteers': volunteersAwaiting,
              '/admin/accounts': recentAccounts,
            }}
            badgeTitles={{
              '/admin/accounts': 'created in the last 7 days',
            }}
            />
          </div>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
