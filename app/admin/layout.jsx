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
  { href: '/admin/activities', label: 'Activities', need: 'coordinator', ready: true, group: 'events' },
  { href: '/admin/buddies', label: 'Buddy Assignments', need: 'coordinator', ready: true, group: 'events' },
  { href: '/admin/lodging', label: 'Rooms & Cabins', need: 'coordinator', ready: true, group: 'events' },
  { href: '/admin/cancellations', label: 'Cancellations', need: 'registrar', ready: true, group: 'events' },
  { href: '/admin/scholarships', label: 'Scholarship Requests', need: 'registrar', ready: true, group: 'events' },
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
  let recentPayments = 0;
  let openCancellations = 0;
  let openScholarships = 0;
  if (can(staff, 'admin')) {
    // Accounts created in the last 7 days -- the same amber treatment as the
    // review queues, so a burst of new signups is visible from any admin page.
    const { data: n } = await supabase.rpc('admin_recent_account_count', { p_days: 7 });
    recentAccounts = n ?? 0;
  }
  if (can(staff, 'registrar')) {
    const paymentsSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [
      { count: changesCount },
      { count: volCount },
      { count: payCount },
      { count: cancelCount },
      { count: scholCount },
    ] = await Promise.all([
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
        // Payment ACTIVITY, not a review queue (asked for 24 Aug). Nothing
        // here is waiting on a decision; the number answers "has money moved
        // since I last looked?", which is the question the payments page gets
        // opened for. Seven days, matching the Accounts badge, so the two
        // numbers on the nav mean the same span of time.
        supabase
          .from('payments')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', paymentsSince),
        // Families waiting to hear back about cancelling. A queue that
        // DRAINS when staff act, so it takes the amber treatment rather
        // than the blue rolling-window one.
        supabase
          .from('registration_cancellation_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open'),
        // Families waiting to hear whether the ministry can help with the
        // fee. Another draining queue, so amber again -- and the one with
        // the least excuse for sitting: a family who has said cost is the
        // problem is deciding whether to come at all.
        supabase
          .from('scholarships')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'requested'),
      ]);
    unreviewedChanges = changesCount ?? 0;
    volunteersAwaiting = volCount ?? 0;
    recentPayments = payCount ?? 0;
    openCancellations = cancelCount ?? 0;
    openScholarships = scholCount ?? 0;
  }

  return (
    <section className="bg-neutral-50 min-h-[70vh] print:bg-white">
      {/* Wider than the public site's container on purpose (24 Aug). The
          admin was living inside the marketing pages' reading-width column,
          which is why the roster needed sideways scrolling on an ordinary
          laptop. Data tables get the screen they're on. */}
      <div className="mx-auto max-w-[1500px] px-4 sm:px-6 py-8 print:p-0 print:max-w-none">
        {/* Header, tidied 23 Aug. It previously said the person's name twice,
            repeated a "My Account" link the site nav already carries, and led
            with the ACCESS LEVEL as the headline. The dashboard leads with the
            person; this now matches -- name first, what they can do second,
            spelled out once each. */}
        {/* min-w-0 flex-1 on the text block is what keeps the buttons ON this
            row: without it the blurb's natural width pushed them to wrap
            underneath (seen in testing screenshots, 24 Aug). */}
        <div className="mb-6 print:hidden flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
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

          {/* Leaving should not require a detour. Staff previously had to open
              the family dashboard just to find a Log Out button, and the only
              route back to their own account was the site nav's "My Account".
              Both are one click from here now. Sign-out is a POST form, not a
              link — see app/auth/signout/route.js for why. */}
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/account/dashboard/" className="btn-outline !py-1.5 text-sm">
              My Dashboard
            </Link>
            <form action="/auth/signout/" method="post">
              <button type="submit" className="btn-outline !py-1.5 text-sm">
                Log Out
              </button>
            </form>
          </div>
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
              '/admin/cancellations': openCancellations,
              '/admin/scholarships': openScholarships,
              '/admin/payments': recentPayments,
            }}
            badgeTitles={{
              '/admin/accounts': 'created in the last 7 days',
              '/admin/cancellations': 'families waiting to hear back',
              '/admin/scholarships': 'families waiting on a decision about the fee',
              '/admin/payments': 'payments in the last 7 days',
            }}
            />
          </div>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
