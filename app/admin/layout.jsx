import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { getProgramLeadership } from '@/lib/programs';
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
  // Registrar rather than coordinator, deliberately: the write goes through
  // registration_participants' UPDATE policy, which is is_registrar(). A
  // coordinator offered this page would find Save did nothing and say
  // nothing, which is the failure this project keeps meeting.
  { href: '/admin/programs', label: 'Programs', need: 'registrar', ready: true, group: 'events' },
  { href: '/admin/cancellations', label: 'Cancellations', need: 'registrar', ready: true, group: 'events' },
  // "Scholarship Requests" wrapped to two lines, dropping its badge onto a
  // line of its own (25 Aug). Shortened to match its neighbours — Rosters,
  // Volunteers, Cancellations are all one word. The page keeps its full title.
  { href: '/admin/scholarships', label: 'Scholarships', need: 'registrar', ready: true, group: 'events' },
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
  const [staff, leaderships] = await Promise.all([getStaff(), getProgramLeadership()]);

  // TWO KINDS OF PERSON REACH THIS LAYOUT.
  //
  // Staff, who get the sidebar their role earns. And program leaders, who are
  // not staff at all -- no row in `staff`, no role, no permissions -- but hold
  // a grant naming one program at one event (migration 0061). A leader gets
  // into the staff area because that is where a roster sensibly lives, and
  // sees exactly one item in the navigation: their own program.
  //
  // Order matters below: a person who is BOTH staff and a named leader is
  // treated as staff, because the wider view already contains the narrower one.
  const isLeaderOnly = !staff && leaderships.length > 0;
  if (!staff && !isLeaderOnly) redirect('/account/?next=/admin/');

  // Staff must have two-factor turned on before they can open the staff area,
  // because everything in here is other families' information. getAuthenticator-
  // AssuranceLevel reports nextLevel === 'aal2' exactly when a verified factor
  // exists; anything else means no factor, so send them to set one up. This is
  // an enrolment gate, not a per-visit challenge -- the login form is what asks
  // for the code each time a staffer with a factor signs in.
  //
  // Program leaders are held to the SAME rule, and that is a decision rather
  // than an accident: what they can see is a list of disabled children's first
  // names, and a password alone is not enough of a door in front of that. It
  // does mean a volunteer leader has to set up an authenticator app before
  // their roster works, which is real friction at camp. If that proves too
  // much, this is the one line to revisit -- but revisit it deliberately.
  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel !== 'aal2') {
    redirect('/account/security?required=1');
  }

  // The person's own name, so the header shows clearly WHO is signed in --
  // not just their role and email.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = staff?.userId ?? user?.id ?? null;
  const viewerEmail = staff?.email ?? user?.email ?? '';

  const { data: profile } = viewerId
    ? await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', viewerId)
        .maybeSingle()
    : { data: null };
  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    viewerEmail;

  // A leader's whole navigation. Not NAV filtered down -- built separately, so
  // that adding a page to NAV can never accidentally hand it to a leader.
  const items = isLeaderOnly
    ? [{ href: '/admin/my-program', label: 'My Program', ready: true }]
    : NAV.filter((n) => can(staff, n.need));

  // The leader's own count: how many people are in their program(s). This is a
  // BLUE badge, not amber, and the distinction is the one AdminNav documents --
  // amber is a queue that drains when you act, blue is a number that just is.
  // A leader has nothing to clear here; they are being told the size of their
  // group, which is exactly the thing they want to know before Monday.
  let myProgramCount = 0;
  if (isLeaderOnly) {
    for (const g of leaderships) {
      const { count } = await supabase
        .from('program_roster')
        .select('participant_id', { count: 'exact', head: true })
        .eq('program_id', g.programId)
        .eq('event_id', g.eventId);
      myProgramCount += count ?? 0;
    }
  }

  // A small attention dot on "Recent Changes" when unreviewed family edits
  // exist. Count only -- cheap head query; RLS scopes what this staffer may
  // count (support-detail rows stay invisible without the sensitive grant).
  let unreviewedChanges = 0;
  let volunteersAwaiting = 0;
  let recentAccounts = 0;
  let recentPayments = 0;
  let openCancellations = 0;
  let openScholarships = 0;
  let awaitingReview = 0;
  let campersWithoutBuddy = 0;
  if (staff && can(staff, 'admin')) {
    // Accounts created in the last 7 days -- the same amber treatment as the
    // review queues, so a burst of new signups is visible from any admin page.
    const { data: n } = await supabase.rpc('admin_recent_account_count', { p_days: 7 });
    recentAccounts = n ?? 0;
  }
  if (staff && can(staff, 'registrar')) {
    const paymentsSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [
      { count: changesCount },
      { count: volCount },
      { count: payCount },
      { count: cancelCount },
      { count: scholCount },
      { count: reviewCount },
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
        // New sign-ups waiting to be confirmed or waitlisted -- the biggest
        // review queue in the ministry, and until now the only one with no
        // number on the nav. It lives on the Overview, which meant the one
        // page that could tell you there was work to do was the one page you
        // had to already be on. Asked for 25 Aug: "not obvious where new
        // registrations get reviewed."
        //
        // 'submitted' only. Waitlisted is a decision already made, and
        // counting it here would put a badge on the nav that no amount of
        // reviewing could clear.
        supabase
          .from('registration_participants')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'submitted'),
      ]);
    unreviewedChanges = changesCount ?? 0;
    volunteersAwaiting = volCount ?? 0;
    recentPayments = payCount ?? 0;
    openCancellations = cancelCount ?? 0;
    openScholarships = scholCount ?? 0;
    awaitingReview = reviewCount ?? 0;
  }

  // Campers who asked for a one-to-one buddy and still have nobody. Asked for
  // 25 Aug: the count existed only as a grey line ON the buddy page, so the
  // one number that says whether camp is ready was invisible from everywhere
  // else. Amber, and it reaches zero when the work is done.
  //
  // Two reads rather than a join: buddy_assignments is keyed by camper
  // participant, and the open ones are the rows with no end date. Scoped to
  // events that have not finished, so last year's camp cannot hold the badge
  // above zero for ever.
  if (staff && can(staff, 'coordinator')) {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: needBuddy }, { data: paired }] = await Promise.all([
      supabase
        .from('registration_participants')
        .select(
          'id, people!inner ( person_support!inner ( buddy_required ) ), registrations!inner ( events!inner ( ends_on ) )'
        )
        .neq('status', 'cancelled')
        .eq('people.person_support.buddy_required', true)
        .gte('registrations.events.ends_on', today),
      supabase.from('buddy_assignments').select('camper_participant_id').is('ended_at', null),
    ]);
    const hasBuddy = new Set((paired ?? []).map((b) => b.camper_participant_id));
    campersWithoutBuddy = (needBuddy ?? []).filter((p) => !hasBuddy.has(p.id)).length;
  }

  // People on a roster for an event that has not finished, with no program
  // yet. A queue that drains: place them and it goes to zero, which is why it
  // is amber. Scoped to live events so last year's camp cannot hold it above
  // zero for ever -- the same trap the buddy badge had to avoid.
  let unplacedPeople = 0;
  if (staff && can(staff, 'registrar')) {
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await supabase
      .from('registration_participants')
      .select('id, registrations!inner ( events!inner ( ends_on ) )', {
        count: 'exact',
        head: true,
      })
      .is('program_id', null)
      .neq('status', 'cancelled')
      .gte('registrations.events.ends_on', today);
    unplacedPeople = count ?? 0;
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
              {isLeaderOnly
                ? 'Program Leader'
                : (ROLE_INFO[staff.role] ?? {}).label ?? staff.role}
            </span>
            {staff?.can_view_sensitive && (
              <span className="rounded-full bg-neutral-200 text-neutral-700 px-2.5 py-0.5 text-xs font-semibold">
                Sensitive access
              </span>
            )}
            {staff?.can_view_giving && (
              <span className="rounded-full bg-neutral-200 text-neutral-700 px-2.5 py-0.5 text-xs font-semibold">
                Giving
              </span>
            )}
            <span className="text-xs text-neutral-500">{viewerEmail}</span>
          </div>
          <p className="text-xs text-neutral-500 mt-1.5">
            {isLeaderOnly
              ? `You lead ${leaderships
                  .map((l) => l.programName)
                  .join(', ')} — you see who is in your program, and nothing else.`
              : (ROLE_INFO[staff.role] ?? {}).blurb ?? 'Staff access.'}
            {staff?.can_view_sensitive ? ' Plus medical & support details.' : ''}
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
              '/admin': awaitingReview,
              '/admin/changes': unreviewedChanges,
              '/admin/volunteers': volunteersAwaiting,
              '/admin/accounts': recentAccounts,
              '/admin/cancellations': openCancellations,
              '/admin/scholarships': openScholarships,
              '/admin/buddies': campersWithoutBuddy,
              '/admin/payments': recentPayments,
              '/admin/programs': unplacedPeople,
              '/admin/my-program': myProgramCount,
            }}
            badgeTitles={{
              '/admin': 'new sign-ups waiting to be confirmed or waitlisted',
              '/admin/accounts': 'created in the last 7 days',
              '/admin/cancellations': 'families waiting to hear back',
              '/admin/scholarships': 'families waiting on a decision about the fee',
              '/admin/buddies': 'campers who asked for a buddy and still have nobody',
              '/admin/payments': 'payments in the last 7 days',
              '/admin/programs': 'people on a roster with no program yet',
              '/admin/my-program': 'people in your program',
            }}
            />
          </div>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
