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
        .select('email, phone, address_line1, home_church')
        .eq('id', householdId)
        .maybeSingle(),
      supabase
        .from('registrations')
        .select(
          `id, event_id, family_notes, created_at,
           registration_participants ( camp_role, status,
             people ( id, first_name, last_name, date_of_birth, gender,
               person_support ( disabilities, dietary_needs ) ) )`
        )
        .eq('household_id', householdId)
        .order('created_at', { ascending: false }),
    ]);

    const wanted = typeof params?.event === 'string' ? params.event : null;
    const reg = (regs ?? []).find((r) => r.event_id === wanted) ?? (regs ?? [])[0] ?? null;

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
        role: ROLE_LABEL[p.camp_role] ?? 'Camper with disability',
        needs: p.people?.person_support?.disabilities ?? '',
        diet: p.people?.person_support?.dietary_needs ?? '',
      }));

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
        church: household?.home_church ?? '',
      },
      members,
    };
  } else {
    // No household yet -- first registration on this account. Hand the wizard
    // what signup already collected so step 1 opens filled in. members stays
    // empty (the wizard shows one blank person card), and isUpdate stays
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
        church: '',
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
        {/* A visible escape hatch. The wizard's own "Cancel" also leads to the
            dashboard, but as a quiet word between Back and Continue it reads
            as "discard", not "leave" -- people reported not finding a way out. */}
        <p className="text-center text-sm mb-8">
          <Link href="/account/dashboard/" className="text-brand underline font-semibold">
            &larr; Back to my dashboard
          </Link>
        </p>
        {weeks.length === 0 ? (
          <p className="text-center text-neutral-600">
            Registration isn&rsquo;t open just yet. Please check back soon.
          </p>
        ) : (
          <FamilyWizard weeks={weeks} defaultEmail={user.email} existing={existing} />
        )}
      </div>
    </section>
  );
}
