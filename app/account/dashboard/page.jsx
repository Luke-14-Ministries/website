import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getStaff } from '@/lib/staff';
import PayPanel from './PayPanel';
import RegistrationCard from './RegistrationCard';
import CancelRequest from './CancelRequest';
import SupportDetailsCard from './SupportDetailsCard';
import { registrationDepositCents } from '@/lib/payments';

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

// "Jul 20–24" / "Oct 29 – Nov 1". Short enough for a title bar, and it is what
// makes a chronological list read as chronological.
function eventDates(ev) {
  const s = ev?.starts_on;
  const e = ev?.ends_on;
  if (!s) return '';
  const fmt = (iso, withYear = false) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
  };
  if (!e || e === s) return fmt(s, true);
  const sameMonth = s.slice(0, 7) === e.slice(0, 7);
  return sameMonth
    ? `${fmt(s)}\u2013${e.split('-')[2].replace(/^0/, '')}, ${e.slice(0, 4)}`
    : `${fmt(s)} \u2013 ${fmt(e, true)}`;
}

const money = (cents) =>
  `$${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling / Child',
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
export default async function DashboardPage({ searchParams }) {
  const params = await searchParams;
  // Set by Stripe's cancel_url when someone backs out of (or fails) a
  // checkout. Landing here with a plain notice replaces being stranded deep
  // in Stripe's back-history (reported 24 Aug).
  const payCancelled = params?.pay === 'cancelled';
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

  // people!people_household_id_fkey — the constraint is named EXPLICITLY, and
  // it has to be. Since 0037 there are two foreign keys between households and
  // people (people.household_id -> households, and
  // households.primary_contact_person_id -> people), so a bare `people ( ... )`
  // is ambiguous: PostgREST refuses the whole query rather than guess. That
  // failure is what emptied this card on 24 Aug -- the error was discarded, the
  // card fell back to its empty state, and a family with people on file was
  // told it had none.
  const { data: households, error: householdError } = householdIds.length
    ? await supabase
        .from('households')
        .select(
          'id, display_name, primary_contact_person_id, people!people_household_id_fkey ( id, first_name, last_name, date_of_birth )'
        )
        .in('id', householdIds)
    : { data: [], error: null };
  if (householdError) {
    // Never silently. An empty card that means "we couldn't load this" must not
    // look like an empty card that means "you have nobody".
    console.error('dashboard household query:', householdError.message);
  }
  const household = households?.[0] ?? null;
  const members = household?.people ?? [];

  // Faces beside names (requested 24 Aug). Signed URLs, because the bucket is
  // private; an hour's expiry outlives any dashboard visit. The logged-in
  // person's own avatar is found by matching their profile name against the
  // household -- there is no direct profile->person link, and a name match is
  // exactly as good as the data it is drawn from, which is fine for a
  // greeting and would not be fine for anything with consequences.
  const photoUrlByPerson = new Map();
  if (members.length) {
    const { data: photoRows } = await supabase
      .from('person_photos')
      .select('person_id, storage_path')
      .in('person_id', members.map((m) => m.id));
    for (const row of photoRows ?? []) {
      if (!row.storage_path) continue;
      const { data: signed } = await supabase.storage
        .from('person-photos')
        .createSignedUrl(row.storage_path, 3600);
      if (signed?.signedUrl) photoUrlByPerson.set(row.person_id, signed.signedUrl);
    }
  }
  const normName = (s) => (s || '').trim().toLowerCase();
  const selfPerson = members.find(
    (m) =>
      normName(m.first_name) === normName(profile?.first_name) &&
      normName(m.last_name) === normName(profile?.last_name)
  );
  const myAvatarUrl = selfPerson ? photoUrlByPerson.get(selfPerson.id) ?? null : null;

  // Registrations for this household, newest first, with the event and each
  // participant.
  const { data: registrations } = householdIds.length
    ? await supabase
        .from('registrations')
        .select(
          `id, family_notes, created_at,
           events ( id, name, starts_on, ends_on, deposit_cents ),
           registration_participants ( id, camp_role, status, fee_cents,
             people ( id, first_name, last_name ) )`
        )
        .in('household_id', householdIds)
        .order('created_at', { ascending: false })
    : { data: [] };

  // Ordered by WHEN THE EVENT IS, not when the family happened to register
  // (asked for 25 Aug). Two tiers, because a plain ascending sort by date puts
  // last month's camp above next month's retreat — technically chronological
  // and exactly wrong for a dashboard, where the thing coming up is the thing
  // you came to deal with.
  //
  //   1. Upcoming first, soonest at the top.
  //   2. Then past events, most recent first — still reachable, out of the way.
  //
  // "Past" is judged on ends_on, so an event running today is still upcoming.
  // Falls back to created_at when an event has no dates at all, which keeps
  // the order stable rather than arbitrary.
  const todayISO = new Date().toISOString().slice(0, 10);
  const eventEnd = (r) => r.events?.ends_on ?? r.events?.starts_on ?? '';
  const eventStart = (r) => r.events?.starts_on ?? r.events?.ends_on ?? '';
  const isPast = (r) => {
    const end = eventEnd(r);
    return Boolean(end) && end < todayISO;
  };

  const regs = [...(registrations ?? [])].sort((a, b) => {
    const aPast = isPast(a);
    const bPast = isPast(b);
    if (aPast !== bPast) return aPast ? 1 : -1;

    const aStart = eventStart(a);
    const bStart = eventStart(b);
    if (!aStart && !bStart) {
      return (b.created_at ?? '').localeCompare(a.created_at ?? '');
    }
    if (!aStart) return 1;
    if (!bStart) return -1;

    // Upcoming: soonest first. Past: most recent first.
    return aPast ? bStart.localeCompare(aStart) : aStart.localeCompare(bStart);
  });
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

  // Support-profile status per person. Registration ends by promising a fuller
  // form for each attendee; this is how the family finds it, and how they can
  // tell at a glance which ones are still outstanding.
  // One entry per PERSON, carrying EVERY role they hold -- not the first one
  // encountered. The old version stopped at the first participant row for a
  // person, which read as a lie the moment somebody held two: a tester
  // registered as a volunteer at one event and a camper at another saw only
  // "Volunteer", then got the full camper support form and reasonably reported
  // it as a bug (31 Aug). The form was right; this line was wrong.
  const byPerson = new Map();
  for (const r of regs) {
    for (const p of r.registration_participants ?? []) {
      const id = p.people?.id;
      if (!id || p.status === 'cancelled') continue;
      if (!byPerson.has(id)) {
        byPerson.set(id, {
          id,
          name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
          roles: [],
        });
      }
      byPerson.get(id).roles.push({
        role: p.camp_role,
        eventName: r.events?.name ?? '',
      });
    }
  }
  const attendingPeople = [...byPerson.values()];

  // "Details on file" means exactly one thing: the details form itself was
  // saved for this person, evidenced by the stamp only that form writes.
  // The previous version inferred it from content and marked BOTH of a
  // family's people done when one form was filled (found in testing, 24 Aug)
  // -- because the registration wizard wrote to some of the same columns.
  // THREE states, not two (31 Aug). Saving the form once used to earn a green
  // "Details on file" even with no photograph and no emergency contact -- a
  // tester saved a mostly-blank form and got the same reassurance as somebody
  // who had filled it in properly. Green is a promise to staff as much as to
  // the family, and it should not be given away for pressing Save.
  //
  // The two things checked beyond the save are the two the form itself calls
  // for by name: the photo ("A photo is required for camp") and the emergency
  // contact ("the one part of the form we'd really like filled in"). Neither
  // BLOCKS -- 0032 decided deliberately that a family without a photo to hand
  // can still hold a place -- so this is amber, never a barrier.
  //
  // Safe to read content here, unlike the 24 Aug bug this replaces: that one
  // inferred completion from columns the registration WIZARD also writes, and
  // so marked a whole family done when one form was filled. Neither the photo
  // nor the emergency contact is ever written by the wizard.
  const supportStatus = new Map(); // personId -> 'complete' | 'incomplete' | 'empty'
  const supportMissing = new Map(); // personId -> ['a photo', 'an emergency contact']
  if (attendingPeople.length) {
    const personIds = attendingPeople.map((p) => p.id);
    const [{ data: supportRows }, { data: photoRows }] = await Promise.all([
      supabase
        .from('person_support')
        .select('person_id, details_saved_at, emergency_contact_name, emergency_contact_phone')
        .in('person_id', personIds),
      supabase.from('person_photos').select('person_id').in('person_id', personIds),
    ]);
    const hasPhoto = new Set((photoRows ?? []).map((r) => r.person_id));
    for (const row of supportRows ?? []) {
      if (!row.details_saved_at) {
        supportStatus.set(row.person_id, 'empty');
        continue;
      }
      const missing = [];
      if (!hasPhoto.has(row.person_id)) missing.push('a photo');
      if (!row.emergency_contact_name?.trim() || !row.emergency_contact_phone?.trim()) {
        missing.push('an emergency contact');
      }
      supportStatus.set(row.person_id, missing.length ? 'incomplete' : 'complete');
      if (missing.length) supportMissing.set(row.person_id, missing);
    }
  }

  // Everyone reviewed? Then the card has done its job and can fold itself to
  // a line (asked for 25 Aug). It is NOT removed: families come back to change
  // a medication or an emergency contact, and a card that vanished when
  // complete would send them hunting.
  const allDetailsDone =
    attendingPeople.length > 0 &&
    attendingPeople.every((p) => supportStatus.get(p.id) === 'complete');

  // Registered volunteers who haven't filed their volunteer application yet —
  // surfaced as a nudge below, because the application is a separate short
  // form at /register/volunteer and is easy to miss.
  const volunteerParts = regs.flatMap((r) =>
    (r.registration_participants ?? []).filter(
      (p) => p.camp_role === 'volunteer' && p.status !== 'cancelled'
    )
  );
  let volunteersNeedingApp = [];
  const volAppStatus = new Map();
  if (volunteerParts.length) {
    const { data: vapps } = await supabase
      .from('volunteer_applications')
      .select('registration_participant_id, status')
      .in('registration_participant_id', volunteerParts.map((p) => p.id));
    for (const a of vapps ?? []) volAppStatus.set(a.registration_participant_id, a.status);
    volunteersNeedingApp = volunteerParts.filter(
      (p) => !volAppStatus.has(p.id) || volAppStatus.get(p.id) === 'withdrawn'
    );
  }
  // "Reviewed separately" matters: the registration pill (e.g. Confirmed)
  // tracks the week's registration, while the application is reviewed by the
  // volunteer team on its own track — without the qualifier the two read as
  // contradictory ("Confirmed" beside "under review").
  const VOL_APP_LABEL = {
    applied: 'submitted — volunteer team reviews this separately',
    approved: 'approved',
    declined: 'not approved — you can update and resubmit',
    withdrawn: 'withdrawn',
  };

  // What each registration still owes, computed by the registration_balances
  // view (fees minus discounts, scholarships, coupons and payments already in).
  const { data: balances } = regIds.length
    ? await supabase
        .from('registration_balances')
        .select(
          'registration_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents, refund_pending_cents'
        )
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

  // Refunds, shown to the family alongside their payments. A refund they
  // cannot see is a refund they telephone about -- and their balance has
  // already changed to account for it, so hiding the cause would make the
  // number look wrong.
  const { data: refundRows } = regIds.length
    ? await supabase
        .from('payment_refunds')
        .select('registration_id, amount_cents, fee_cover_cents, status, reason, refunded_on, created_at')
        .in('registration_id', regIds)
        .in('status', ['pending', 'succeeded'])
        .order('created_at', { ascending: false })
    : { data: [] };
  const refundsByReg = new Map();
  for (const r of refundRows ?? []) {
    if (!refundsByReg.has(r.registration_id)) refundsByReg.set(r.registration_id, []);
    refundsByReg.get(r.registration_id).push(r);
  }
  // Buddies, but only where staff have PUBLISHED them: the RLS policy on
  // buddy_assignments checks buddies_published(event_id), so an unpublished
  // pairing simply returns nothing here. No client-side gate needed -- the
  // database refuses to hand it over, which is the right place for that rule.
  const myParticipantIds = regs.flatMap((r) =>
    (r.registration_participants ?? []).map((p) => p.id)
  );
  const buddyNameByParticipant = new Map();
  if (myParticipantIds.length) {
    const { data: buddyRows } = await supabase
      .from('buddy_assignments')
      .select(
        `camper_participant_id,
         buddy:registration_participants!buddy_assignments_buddy_participant_id_fkey (
           people ( first_name, last_name ) )`
      )
      .in('camper_participant_id', myParticipantIds)
      .is('ended_at', null);
    for (const b of buddyRows ?? []) {
      const n = `${b.buddy?.people?.first_name ?? ''} ${b.buddy?.people?.last_name ?? ''}`.trim();
      if (n) buddyNameByParticipant.set(b.camper_participant_id, n);
    }
  }

  // Where each person is sleeping, once staff have published. Same story as
  // buddies: the RLS policy checks lodging_published(event_id), so an
  // unpublished draft returns nothing and no client-side gate is needed.
  const lodgingByParticipant = new Map();
  if (myParticipantIds.length) {
    const { data: bedRows } = await supabase
      .from('lodging_assignments')
      .select('registration_participant_id, lodgings ( name, parent:lodgings!lodgings_parent_id_fkey ( name ) )')
      .in('registration_participant_id', myParticipantIds);
    for (const b of bedRows ?? []) {
      const room = b.lodgings?.name;
      if (!room) continue;
      const parent = b.lodgings?.parent?.name;
      lodgingByParticipant.set(
        b.registration_participant_id,
        parent ? `${parent} — ${room}` : room
      );
    }
  }

  // Open cancellation requests, so a registration that has one shows its
  // status instead of offering to raise another.
  const cancelByReg = new Map();
  if (regIds.length) {
    const { data: cancelRows } = await supabase
      .from('registration_cancellation_requests')
      .select('id, registration_id, participant_ids, reason, requested_at')
      .in('registration_id', regIds)
      .eq('status', 'open');
    for (const c of cancelRows ?? []) cancelByReg.set(c.registration_id, c);
  }

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

  // Order, settled 25 Aug after a first attempt got it backwards.
  //
  // THE STAFF DOOR IS NAVIGATION. It is the site-wide nav for the handful of
  // accounts that have a second place to be, and navigation belongs at the top
  // whether or not it is urgent. Burying it under the registrations treated it
  // as an aside, which it is not.
  //
  // THE SUPPORT CARD MOVES. Unfinished, it is a to-do that has to catch the eye
  // at login, so it sits ABOVE the registrations. Finished, it is a record of
  // something done, and records belong under the thing they are about. Same
  // card, two homes, decided by whether there is anything left to do —
  // a list that never moves teaches people to stop reading it.
  const supportCard = (
    <>
        {/* The support profiles registration promises. One card, one row per
            person attending, so the promise made at the end of the wizard has
            somewhere to land. */}
        {attendingPeople.length > 0 && (
          <SupportDetailsCard
            allDone={allDetailsDone}
            count={attendingPeople.length}
          >
            <h2 className="text-xl font-bold">Support details</h2>
            <p className="mt-1 text-sm text-neutral-600">
              A short form for each person attending — allergies, medications, what helps on
              a hard day, and an emergency contact. Most of it is optional, but please fill
              in what applies: staff use these to plan support, meals and medical cover.
            </p>
            <ul className="mt-4 divide-y divide-neutral-100">
              {attendingPeople.map((p) => {
                const state = supportStatus.get(p.id) ?? 'empty';
                const missing = supportMissing.get(p.id) ?? [];
                const PILL = {
                  complete: ['bg-green-100 text-green-800', 'Details on file'],
                  incomplete: ['bg-amber-100 text-amber-800', 'Incomplete'],
                  empty: ['bg-amber-100 text-amber-800', 'Not started'],
                };
                const [pillClass, pillText] = PILL[state];
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{p.name}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${pillClass}`}>
                          {pillText}
                        </span>
                      </span>
                      {/* Every role this person holds, not just the first. A
                          person can be a volunteer at one event and a camper at
                          another, and showing one of them makes the other look
                          like a mistake. */}
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        {p.roles
                          .map(
                            (r) =>
                              `${ROLE_LABEL[r.role] ?? r.role}${r.eventName ? ` · ${r.eventName}` : ''}`
                          )
                          .join('  |  ')}
                      </span>
                      {/* Says WHAT is missing. "Incomplete" on its own sends
                          somebody back through five sections hunting for it. */}
                      {missing.length > 0 && (
                        <span className="mt-0.5 block text-xs text-amber-800">
                          Still needed: {missing.join(' and ')}
                        </span>
                      )}
                    </span>
                    <Link
                      href={`/account/details/${p.id}/`}
                      className={
                        state === 'empty'
                          ? 'btn-primary !py-1.5 text-sm'
                          : 'btn-outline !py-1.5 text-sm'
                      }
                    >
                      {state === 'empty'
                        ? 'Fill it in'
                        : state === 'incomplete'
                          ? 'Finish it'
                          : 'Review or update'}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </SupportDetailsCard>
        )}
    </>
  );

  return (
    <section className="bg-neutral-50 min-h-[70vh] py-12">
      <div className="container-site">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold">
              {myAvatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={myAvatarUrl}
                  alt=""
                  className="h-11 w-11 rounded-full object-cover border border-neutral-200"
                />
              )}
              Welcome back, {greeting}!
            </h1>
            <p className="text-neutral-500">Signed in as {user.email}</p>
          </div>
          {/* A form, not a link. See app/auth/signout/route.js for why. */}
          <form action="/auth/signout/" method="post">
            <button type="submit" className="btn-outline !py-2">
              Log Out
            </button>
          </form>
        </div>

        {payCancelled && (
          <div className="mb-8 rounded-lg border border-neutral-300 bg-white p-5">
            <p className="font-semibold">That payment wasn&rsquo;t completed.</p>
            <p className="mt-1 text-sm text-neutral-600">
              Nothing was charged. Your balance is unchanged below — you can try again
              whenever you&rsquo;re ready, and choosing bank transfer sends more of your
              payment to the ministry. If a card was declined, your bank can usually say
              why.
            </p>
          </div>
        )}

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

        {!allDetailsDone && supportCard}

        {/* TWO COLUMNS, NOT FOUR CELLS.
            This was one 3-column grid holding four cards in row order, which
            put My Account Settings in row 2 -- and row 2 cannot begin until the
            tall Registrations card in row 1 ends. The result was a column of
            white space under My Household and the settings card stranded most
            of a screen below it (26 Aug). items-start stops a card stretching;
            it cannot stop a row starting late.

            Each side is now its own flex column, so the right-hand cards stack
            against each other instead of against a row boundary. order-* still
            drives the donor-first swap, and now does it within a column.

            The wrappers are `contents` below lg, which removes them from
            layout entirely so all four cards are direct grid children again on
            a phone. That matters: on one narrow column the old reading order
            was Registrations, Household, Giving, Settings, and wrapping would
            have pushed Household below Giving -- demoting "your people" under
            "your money" on the screen most families will actually use. With
            display:contents the order-* classes still place all four, so the
            phone keeps the order it had and only the wide layout changes. */}
        <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
          <div className="contents lg:flex lg:flex-col lg:gap-6 lg:col-span-2">
          {/* Registrations -- real */}
          <div className={`rounded-lg bg-white border border-neutral-200 shadow-sm p-6 ${donorFirst ? 'order-3' : 'order-1'}`}>
            <h2 className="text-xl font-bold mb-4">My Registrations</h2>

            {regs.length === 0 ? (
              <div className="rounded border border-dashed border-neutral-300 p-6 text-center text-neutral-600">
                <p>You haven&rsquo;t registered anyone yet.</p>
                <Link href="/register/" className="btn-primary !py-2 mt-4 inline-block">
                  Register for an Event
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {regs.map((r) => {
                  const parts = r.registration_participants ?? [];
                  const total = parts.reduce((s, p) => s + (p.fee_cents ?? 0), 0);

                  // What this registration still wants, said on the title bar
                  // so a COLLAPSED card is still honest about it. Computed
                  // here, on the server, from the same balance rows the body
                  // uses -- the bar and the card can never disagree.
                  const bal = balByReg.get(r.id);
                  const clearing = pendingByReg.get(r.id) ?? 0;
                  // Per PERSON (31 Aug). See registrationDepositCents.
                  const depositCents = registrationDepositCents({
                    perPersonCents: r.events?.deposit_cents,
                    participants: r.registration_participants,
                    balanceCents: bal?.balance_cents,
                  });
                  const nothingPaid =
                    bal && (bal.paid_cents ?? 0) === 0 && clearing === 0;
                  const depositDue =
                    depositCents > 0 && nothingPaid && (bal?.balance_cents ?? 0) > 0;
                  const owes = (bal?.balance_cents ?? 0) > 0;

                  // The balance pill comes first on EVERY card that owes
                  // anything, so the same slot always answers the same
                  // question and three cards can be read down the page. The
                  // deposit is a second pill rather than a replacement: it is
                  // a different fact -- what is being asked for right now --
                  // and swapping one for the other made "$1,400 balance" and
                  // "$50 deposit due" look like the same measurement taken on
                  // two registrations (flagged 26 Aug: "not wrong, just
                  // inconsistent").
                  const status = owes
                    ? [
                        { text: `${money(bal.balance_cents)} balance`, tone: 'amber' },
                        ...(depositDue
                          ? [{ text: `${money(depositCents)} deposit due now`, tone: 'ask' }]
                          : []),
                      ]
                    : clearing > 0
                      ? [{ text: 'Clearing the bank', tone: 'neutral' }]
                      : bal
                        ? [{ text: 'Paid in full', tone: 'green' }]
                        : null;

                  // Open by default when something is outstanding, or when
                  // there is only one registration (nothing to tidy away).
                  const defaultOpen = depositDue || owes || regs.length === 1;

                  return (
                    <RegistrationCard
                      key={r.id}
                      eventName={r.events?.name ?? 'Camp registration'}
                      dateLabel={eventDates(r.events)}
                      past={isPast(r)}
                      peopleLabel={`${parts.length} ${parts.length === 1 ? 'person' : 'people'}`}
                      totalLabel={money(total)}
                      status={status}
                      defaultOpen={defaultOpen}
                    >
                      <ul className="mt-3 divide-y divide-neutral-100">
                        {parts.map((p, i) => {
                          const [label, cls] = STATUS[p.status] ?? STATUS.submitted;
                          return (
                            <li key={i} className="py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span>
                                  {p.people?.first_name} {p.people?.last_name}
                                  <span className="text-neutral-500"> — {ROLE_LABEL[p.camp_role] ?? p.camp_role}</span>
                                </span>
                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
                                  {label}
                                </span>
                              </div>
                              {lodgingByParticipant.get(p.id) && (
                                <p className="mt-1 text-xs text-neutral-600">
                                  Staying in:{' '}
                                  <span className="font-semibold">
                                    {lodgingByParticipant.get(p.id)}
                                  </span>
                                </p>
                              )}
                              {buddyNameByParticipant.get(p.id) && (
                                <p className="mt-1 text-xs text-neutral-600">
                                  Buddy for the week:{' '}
                                  <span className="font-semibold">
                                    {buddyNameByParticipant.get(p.id)}
                                  </span>
                                </p>
                              )}
                              {/* Volunteers keep a permanent path back to their
                                  application — the amber banner only covers the
                                  not-yet-filed case. */}
                              {p.camp_role === 'volunteer' && p.status !== 'cancelled' && (
                                <p className="mt-1 text-xs text-neutral-500">
                                  Volunteer application:{' '}
                                  {VOL_APP_LABEL[volAppStatus.get(p.id)] ?? 'not started'} ·{' '}
                                  <Link href="/register/volunteer" className="text-brand underline font-semibold">
                                    {volAppStatus.has(p.id) ? 'View / edit' : 'Start it'}
                                  </Link>
                                </p>
                              )}
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
                          {/* Refunds sit with the payments they reverse, not in
                              a separate place: the family's question is "what
                              happened to my money", and that is one story. */}
                          {(refundsByReg.get(r.id) ?? []).length > 0 && (
                            <ul className="mt-2 border-t border-neutral-200 pt-2 text-sm">
                              {(refundsByReg.get(r.id) ?? []).map((rf, i) => (
                                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1">
                                  <span className="text-neutral-700">
                                    {(rf.refunded_on ?? rf.created_at ?? '').slice(0, 10)} · Refunded{' '}
                                    <span className="font-semibold">{money(rf.amount_cents)}</span>
                                    {(rf.fee_cover_cents ?? 0) > 0 && (
                                      <span className="text-neutral-500">
                                        {' '}+ {money(rf.fee_cover_cents)} processing
                                      </span>
                                    )}
                                    {rf.reason && (
                                      <span className="text-neutral-500"> — {rf.reason}</span>
                                    )}
                                    {/* Where the money actually goes, in the
                                        family's terms. They do not know or care
                                        that the ministry uses Stripe (26 Aug);
                                        they care that $10 is coming back and
                                        roughly when, so that they do not ring up
                                        on day two. */}
                                    <span className="block text-xs text-neutral-500">
                                      {rf.status === 'succeeded'
                                        ? 'Sent back to the card or bank account you paid from.'
                                        : 'On its way back to the card or bank account you paid from — this usually takes a few days.'}
                                    </span>
                                  </span>
                                  <span
                                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                      rf.status === 'succeeded'
                                        ? 'bg-green-100 text-green-800'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {rf.status === 'succeeded' ? 'Refunded' : 'Refund on its way'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
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
                            {/* Beside the balance, never inside it (0053). A
                                refund that has not landed is not money the
                                family has back, and it must not quietly turn
                                into something they owe. */}
                            {(b.refund_pending_cents ?? 0) > 0 && (
                              <div className="flex justify-between py-0.5 text-amber-800">
                                <span>Refund on its way</span>
                                <span>{money(b.refund_pending_cents)}</span>
                              </div>
                            )}
                            <div className="flex justify-between py-0.5 border-t border-neutral-200 font-semibold">
                              <span>{bal < 0 ? 'Credit' : 'Balance'}</span>
                              <span className={bal < 0 ? 'text-green-700' : bal > 0 ? 'text-amber-700' : ''}>
                                {bal < 0 ? `−${money(-bal)}` : money(bal)}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Deposit-due banner (Larry, 24 Aug: the $50 deposit is
                          REQUIRED). Implemented as a strong, explained ask
                          rather than a hard gate -- the registration is
                          already saved by the time anyone reads this, and a
                          family stuck at a payment wall abandons; a family
                          told plainly why the deposit matters pays it. Shown
                          only while NOTHING has been paid or is clearing. */}
                      {(() => {
                        const b = balByReg.get(r.id);
                        const dep = registrationDepositCents({
                          perPersonCents: r.events?.deposit_cents,
                          participants: r.registration_participants,
                          balanceCents: b?.balance_cents,
                        });
                        const heads = (r.registration_participants ?? []).filter(
                          (x) => x?.status !== 'cancelled'
                        ).length;
                        const nothingPaid =
                          b && (b.paid_cents ?? 0) === 0 && (pendingByReg.get(r.id) ?? 0) === 0;
                        if (!(dep > 0 && nothingPaid && (b?.balance_cents ?? 0) > 0)) return null;
                        return (
                          <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            <p className="font-semibold">
                              A {money(dep)} deposit is required to hold your spots
                              {heads > 1
                                ? ` — ${money(r.events?.deposit_cents ?? 0)} for each of the ${heads} people on this registration.`
                                : '.'}
                            </p>
                            <p className="mt-1">
                              The deposit is your family&rsquo;s commitment to come — and it lets
                              the ministry book vendors and reserve locations with real numbers.
                              The rest of the balance can be paid in one go or in parts; camp
                              staff will be in touch about the due date.
                            </p>
                          </div>
                        );
                      })()}

                      {/* Two rows, not one wrapping row, because these are two
                          different errands and the wrap point was deciding the
                          grouping for us (flagged 26 Aug). Money first: what a
                          family owes, how to ask for help with it, and the
                          statement that shows the arithmetic. Then the
                          registration itself: who is coming, what they will do,
                          what has been signed. Explicit rows keep the pairs
                          together at any width. */}
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <PayPanel
                          registrationId={r.id}
                          balanceCents={balanceByReg.get(r.id)}
                          depositCents={registrationDepositCents({
                            perPersonCents: r.events?.deposit_cents,
                            participants: r.registration_participants,
                            balanceCents: balanceByReg.get(r.id),
                          })}
                          pendingCents={pendingByReg.get(r.id)}
                          paidCents={balByReg.get(r.id)?.paid_cents}
                        />
                        {/* Offered plainly beside Pay rather than hidden behind
                            "having trouble?" — the ministry raises money for
                            this, and a link people have to hunt for is one most
                            families will not click. */}
                        <Link
                          href={`/account/scholarship/${r.id}`}
                          title="Ask for help with the fee. It will not affect anyone's place."
                          className="btn-outline !py-2"
                        >
                          Request help with the fee
                        </Link>
                        <Link
                          href={`/account/statement/${r.id}`}
                          title="A printable statement: fees, scholarships, payments, and balance."
                          className="btn-outline !py-2"
                        >
                          Statement
                        </Link>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <Link
                          href={`/register/family/?event=${r.events?.id ?? ''}`}
                          title="Opens your saved registration so you can make changes."
                          className="btn-outline !py-2"
                        >
                          Edit Registration
                        </Link>
                        {/* Activities live on their own page: a family with
                            three people and eleven activities is more screen
                            than a dashboard card should carry. */}
                        <Link
                          href="/account/activities/"
                          title="Choose horseback riding, the boat, rafting and the rest."
                          className="btn-outline !py-2"
                        >
                          Choose activities
                        </Link>
                        {/* Agreements are event things, so the primary route
                            to them lives with the event (flagged 24 Aug); the
                            account-settings link remains as a second door. */}
                        <Link
                          href="/account/agreements/"
                          title="The agreements you signed for this registration, with the exact wording."
                          className="btn-outline !py-2"
                        >
                          Signed agreements
                        </Link>
                      </div>

                      {/* Last, quiet, and behind a disclosure. Cancelling is
                          rare and consequential; it does not belong beside
                          Pay as an equal-weight button. */}
                      <CancelRequest
                        registrationId={r.id}
                        people={parts.map((p) => ({
                          participantId: p.id,
                          name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
                        }))}
                        openRequest={cancelByReg.get(r.id) ?? null}
                      />
                    </RegistrationCard>
                  );
                })}
                <Link href="/register/family" className="btn-outline !py-2 inline-block">
                  New Registration
                </Link>
              </div>
            )}
          </div>

          {/* Giving -- real history, giving-first for donors */}
          <div className={`rounded-lg bg-white border border-neutral-200 shadow-sm p-6 ${donorFirst ? 'order-1' : 'order-3'}`}>
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

          </div>

          <div className="contents lg:flex lg:flex-col lg:gap-6">
          {/* Household -- real */}
          <div className={`rounded-lg bg-white border border-neutral-200 shadow-sm p-6 ${donorFirst ? 'order-4' : 'order-2'}`}>
            <h2 className="text-xl font-bold mb-4">My Household</h2>
            {householdError ? (
              <p className="text-amber-800">
                We couldn&rsquo;t load your household just now. Refreshing usually fixes
                it — if it doesn&rsquo;t, please let the ministry know.
              </p>
            ) : members.length === 0 ? (
              <p className="text-neutral-500">
                No family members on file yet — add them below, or they&rsquo;re added
                automatically when you register.
              </p>
            ) : (
              <ul className="space-y-2 text-neutral-700">
                {members.map((m) => {
                  const age = ageFrom(m.date_of_birth);
                  const photo = photoUrlByPerson.get(m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-3">
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photo}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-full object-cover border border-neutral-200"
                        />
                      ) : (
                        <span
                          aria-hidden
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold text-neutral-400"
                        >
                          {(m.first_name?.[0] ?? '') + (m.last_name?.[0] ?? '')}
                        </span>
                      )}
                      <span>
                        {m.first_name} {m.last_name}
                        <span className="text-neutral-500">
                          {age != null ? ` (age ${age})` : ' (no DOB provided)'}
                        </span>
                        {/* Named here so "who do staff call?" is answerable
                            from the dashboard, and so changing the contact
                            visibly changes something (0037). */}
                        {household?.primary_contact_person_id === m.id && (
                          <span
                            className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600"
                            title="Camp staff contact this person about your household"
                          >
                            primary contact
                          </span>
                        )}
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
                {/* A family should never have to ask us what they signed. */}
                <Link href="/account/agreements" className="text-brand underline">
                  Signed agreements &amp; permissions
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


        {allDetailsDone && supportCard}
      </div>
    </section>
  );
}
