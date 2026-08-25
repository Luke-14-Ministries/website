import Link from 'next/link';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { programOf, registrationOpen, OPEN_EVENT_COLUMNS } from '@/lib/events';
import FamilyWizard from './FamilyWizard';

export const metadata = { title: 'Family Registration — Luke 14 Ministries' };

// The database's camp_role values -> the wizard's human-readable labels.
const ROLE_LABEL = {
  camper: 'Camper with disability',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
};

// Display order for the agreement block. Anything not listed sorts to the end.
const AGREEMENT_ORDER = [
  'emergency_consent',
  'hold_harmless',
  'event_rules',
  'communication_consent',
  'scholarship_agreement',
  'payment_by_check',
];
const agreementRank = (key) => {
  const i = AGREEMENT_ORDER.indexOf(key);
  return i === -1 ? AGREEMENT_ORDER.length : i;
};

// A server component: it runs on the server, so it can check who is logged in and
// read the published camp weeks straight from the database before rendering.
export default async function FamilyRegisterPage({ searchParams }) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // Registration saves to the family's own account, and row-level security ties
  // every write to a logged-in user -- so the door is a login, not an anonymous
  // form. Send guests to log in (or sign up) and back here.
  if (!user) {
    const next = encodeURIComponent('/register/family/');
    return (
      <section className="bg-neutral-50 py-12">
        <div className="container-site max-w-xl mx-auto text-center">
          <h1 className="text-4xl font-bold">Family Registration</h1>
          <p className="mt-4 text-neutral-700">
            Please log in or create an account first. Your registration is saved to
            your account so you can leave and come back to it, and only you and camp
            staff can ever see it.
          </p>
          <div className="mt-6 flex gap-3 justify-center">
            <Link href={`/account/?next=${next}`} className="btn-primary">
              Log In
            </Link>
            <Link href={`/account/signup/?next=${next}`} className="btn-outline">
              Create Account
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // Published Camp Celebrate weeks and their single enrollment option each.
  // RLS already limits this to published rows, so this is safe to run as the family.
  const supabase = await createClient();
  const { data: events } = await supabase
    .from('events')
    .select(OPEN_EVENT_COLUMNS)
    .eq('published', true)
    .order('starts_on', { ascending: true });

  // Honor the registration windows staff set on the Setup page, and -- when
  // the chooser sent a ?program= -- narrow the week picker to that program's
  // sessions, so nobody chooses twice. An unknown program value just falls
  // back to everything open rather than a dead end.
  const chosenProgram =
    typeof params?.program === 'string' ? params.program : null;
  let openEvents = (events ?? []).filter((e) => registrationOpen(e));
  if (chosenProgram) {
    const scoped = openEvents.filter((e) => programOf(e.name) === chosenProgram);
    if (scoped.length > 0) openEvents = scoped;
  }

  // The agreements required for the sessions on offer. Loaded through
  // agreement_requirements rather than "all active agreements", so an event
  // that has not had its paperwork reviewed cannot silently inherit someone
  // else's liability text. Deduped by key -- the same six currently apply to
  // every event, and a family signs each one once.
  const openEventIds = openEvents.map((e) => e.id);
  let requiredAgreements = [];
  if (openEventIds.length > 0) {
    const { data: reqRows } = await supabase
      .from('agreement_requirements')
      .select('agreement_id, is_required, agreements ( key, title, body, active )')
      .in('event_id', openEventIds)
      .eq('is_required', true);

    const seen = new Set();
    requiredAgreements = (reqRows ?? [])
      .map((r) => r.agreements)
      .filter((a) => a?.active && !seen.has(a.key) && seen.add(a.key))
      .map((a) => ({ key: a.key, title: a.title, body: a.body }))
      // Heaviest first: the two that decide whether someone may attend at all,
      // then the rules, then the three that are informational for most people.
      .sort((a, b) => agreementRank(a.key) - agreementRank(b.key));
  }

  const weeks = openEvents
    .map((e) => {
      const opt = (e.event_options ?? []).find((o) => o.published);
      return opt
        ? {
            eventId: e.id,
            optionId: opt.id,
            name: e.name,
            startsOn: e.starts_on,
            endsOn: e.ends_on,
            feeCents: opt.fee_cents,
          }
        : null;
    })
    .filter(Boolean);

  // ---- Prefill. Two tiers:
  //  1. An account with a household gets its saved registration loaded (an
  //     "update", not a blank slate).
  //  2. A FIRST-TIME account still gets its signup details back -- name and
  //     phone were typed into the signup form minutes ago and live in
  //     public.profiles, so re-asking for them made the first registration
  //     feel like starting over. (Reported by the user, 21 Aug 2026.)
  // ?event=<id> picks which registration to prefill; otherwise the most
  // recent. ----
  let existing = null;
  let signedAlready = null;
  // Everyone saved in this household, offered as pick-and-add in the wizard.
  let householdPeople = [];
  // "How did you hear about us?" is a first-contact question, so it is asked
  // once per family and never again. CampSite asks it on every enrolment, which
  // is why their export repeats the same answer for every child every year.
  let askHeardAbout = true;
  const [{ data: memberRows }, { data: profile }] = await Promise.all([
    supabase
      .from('household_members')
      .select('household_id')
      .eq('profile_id', user.id)
      .limit(1),
    supabase
      .from('profiles')
      .select('first_name, last_name, phone')
      .eq('id', user.id)
      .maybeSingle(),
  ]);
  const householdId = memberRows?.[0]?.household_id;

  if (householdId) {
    const [{ data: household }, { data: regs }] = await Promise.all([
      supabase
        .from('households')
        .select('email, phone, address_line1, city, state, postal_code, home_church, how_did_you_hear')
        .eq('id', householdId)
        .maybeSingle(),
      supabase
        .from('registrations')
        .select(
          `id, event_id, family_notes, created_at,
           registration_participants ( camp_role, status, tshirt_size, first_time_attending,
             people ( id, first_name, last_name, date_of_birth, gender ) )`
        )
        .eq('household_id', householdId)
        .order('created_at', { ascending: false }),
    ]);

    const wanted = typeof params?.event === 'string' ? params.event : null;
    const reg = (regs ?? []).find((r) => r.event_id === wanted) ?? (regs ?? [])[0] ?? null;

    // Has this household already signed for THIS registration? If so the form
    // shows the signature rather than asking for it again.
    if (reg?.id) {
      const { data: sigs } = await supabase
        .from('agreement_signatures')
        .select('signer_name, signed_at')
        .eq('registration_id', reg.id)
        .eq('household_id', householdId)
        .order('signed_at', { ascending: true })
        .limit(1);
      if (sigs?.[0]) {
        signedAlready = { signerName: sigs[0].signer_name, signedAt: sigs[0].signed_at };
      }
    }

    // Latest media / directory answer per person, so the form opens showing
    // what this family already told us rather than a blank select that reads
    // as "we never asked".
    const { data: consentRows } = await supabase
      .from('person_consents')
      .select('person_id, kind, granted, recorded_at, people!inner ( household_id )')
      .eq('people.household_id', householdId)
      .order('recorded_at', { ascending: false });

    const latestConsent = new Map(); // `${personId}:${kind}` -> 'true' | 'false'
    for (const c of consentRows ?? []) {
      const k = `${c.person_id}:${c.kind}`;
      if (!latestConsent.has(k)) latestConsent.set(k, c.granted ? 'true' : 'false');
    }

    // T-shirt size and "first time?" carry across events: someone who told us
    // their size last summer should not have to hunt for it again. `regs` is
    // newest-first, so the first non-null answer we meet is the freshest one.
    const carried = new Map();
    for (const r of regs ?? []) {
      for (const p of r.registration_participants ?? []) {
        const id = p.people?.id;
        if (!id) continue;
        const prev = carried.get(id) ?? {};
        carried.set(id, {
          tshirt: prev.tshirt ?? p.tshirt_size ?? null,
          firstTime: prev.firstTime ?? p.first_time_attending ?? null,
        });
      }
    }

    const members = (reg?.registration_participants ?? [])
      .filter((p) => p.status !== 'cancelled')
      .map((p) => ({
        // The person's ID rides along invisibly so an edit (a rename included)
        // updates the SAME person instead of creating a look-alike.
        personId: p.people?.id ?? null,
        firstName: p.people?.first_name ?? '',
        lastName: p.people?.last_name ?? '',
        dob: p.people?.date_of_birth ?? '',
        sex: p.people?.gender ?? '',
        // No fallback label: an unrecognised role must be re-chosen, not
        // silently defaulted to the most sensitive answer on the form.
        role: ROLE_LABEL[p.camp_role] ?? '',
        tshirt:
          p.tshirt_size ?? carried.get(p.people?.id)?.tshirt ?? '',
        firstTime: (() => {
          const v = p.first_time_attending ?? carried.get(p.people?.id)?.firstTime;
          // The wizard's select holds strings; null means "not answered".
          return v === true ? 'true' : v === false ? 'false' : '';
        })(),
        // Both open CHECKED every year, including for a family that declined
        // last time. Lawrence's reasoning, 23 Aug: trust is built by attending
        // -- a family who was wary before camp is often comfortable after it,
        // and a permanently remembered "no" never gives them the chance to say
        // yes. A prior refusal is surfaced beside the box instead (see
        // mediaWasNo / directoryWasNo) so nobody flips a considered decision by
        // skimming.
        mediaConsent: 'true',
        directoryConsent: 'true',
        mediaWasNo: latestConsent.get(`${p.people?.id}:media`) === 'false',
        directoryWasNo: latestConsent.get(`${p.people?.id}:directory`) === 'false',
      }));

    // EVERY person in the household, not only those on the last registration.
    // This is what lets the wizard offer "add someone you've already saved"
    // instead of making a family retype the same children each year (24 Aug).
    const { data: allPeople } = await supabase
      .from('people')
      .select('id, first_name, last_name, date_of_birth, gender')
      .eq('household_id', householdId)
      .order('created_at');
    householdPeople = (allPeople ?? []).map((p) => ({
      personId: p.id,
      firstName: p.first_name ?? '',
      lastName: p.last_name ?? '',
      dob: p.date_of_birth ?? '',
      sex: p.gender ?? '',
      tshirt: carried.get(p.id)?.tshirt ?? '',
      firstTime: (() => {
        const v = carried.get(p.id)?.firstTime;
        return v === true ? 'true' : v === false ? 'false' : '';
      })(),
      mediaWasNo: latestConsent.get(`${p.id}:media`) === 'false',
      directoryWasNo: latestConsent.get(`${p.id}:directory`) === 'false',
    }));

    askHeardAbout = !household?.how_did_you_hear;

    existing = {
      isUpdate: !!reg,
      eventId: reg?.event_id ?? wanted ?? null,
      notes: reg?.family_notes ?? '',
      family: {
        contactFirst: profile?.first_name ?? '',
        contactLast: profile?.last_name ?? '',
        email: household?.email ?? user.email ?? '',
        phone: household?.phone ?? profile?.phone ?? '',
        address: household?.address_line1 ?? '',
        city: household?.city ?? '',
        state: household?.state ?? '',
        postalCode: household?.postal_code ?? '',
        church: household?.home_church ?? '',
        heardAbout: '',
        heardAboutFrom: '',
      },
      members,
    };
  } else {
    // No household yet -- first registration on this account. Hand the form
    // what signup already collected so "Your family" opens filled in. members
    // stays empty (the form shows one blank person card), and isUpdate stays
    // false so the wording remains "Submit".
    existing = {
      isUpdate: false,
      eventId: typeof params?.event === 'string' ? params.event : null,
      notes: '',
      family: {
        contactFirst: profile?.first_name ?? '',
        contactLast: profile?.last_name ?? '',
        email: user.email ?? '',
        phone: profile?.phone ?? '',
        address: '',
        city: '',
        state: '',
        postalCode: '',
        church: '',
        heardAbout: '',
        heardAboutFrom: '',
      },
      members: [],
    };
  }

  return (
    <section className="bg-neutral-50 py-12">
      <div className="container-site max-w-3xl mx-auto">
        {/* Generic on purpose: the ministry runs several events, and this
            wizard serves all of them -- the event itself is chosen (or
            preselected via ?event=) in step 3. The old hardcoded
            "Camp Celebrate 2026" title presumed camp on every neutral entry. */}
        <h1 className="text-4xl font-bold text-center">Family Registration</h1>
        {chosenProgram && weeks.length > 0 && (
          <p className="text-center text-lg text-brand-dark font-semibold mt-1">
            {chosenProgram}
          </p>
        )}
        <p className="text-center text-neutral-600 mt-3 mb-2">
          Signed in as {user.email}.{' '}
          {existing?.isUpdate
            ? 'Your saved registration is loaded below — make changes and update.'
            : 'Your answers save to your account.'}
        </p>
        {/* The back-to-dashboard escape link is rendered INSIDE the wizard,
            not here -- so it can disappear when the success card (which has
            its own dashboard button) is showing. Two dashboard links on the
            confirmation screen read as clutter (flagged 24 Aug). */}
        {weeks.length === 0 ? (
          <p className="text-center text-neutral-600">
            Registration isn&rsquo;t open just yet. Please check back soon.
          </p>
        ) : (
          <FamilyWizard
            weeks={weeks}
            defaultEmail={user.email}
            existing={existing}
            askHeardAbout={askHeardAbout}
            agreements={requiredAgreements}
            signedAlready={signedAlready}
            householdPeople={householdPeople}
          />
        )}
      </div>
    </section>
  );
}
