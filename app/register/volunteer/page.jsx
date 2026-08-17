import Link from 'next/link';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import VolunteerApplication from './VolunteerApplication';

export const metadata = { title: 'Volunteer — Luke 14 Ministries' };

// The volunteer application, for real. The sequence is: create an account,
// register (choosing the role "Volunteer" — solo volunteers are simply a
// household of one), then complete the short application here. Staff review
// applications on the admin Volunteers page; background-check paperwork never
// touches this site (a yes/no and dates live in volunteer_clearances,
// documents stay in the restricted SharePoint folder).
export default async function VolunteerPage() {
  const user = await getCurrentUser();

  // ---- Logged out: explain the sequence. ----
  if (!user) {
    return (
      <section className="bg-neutral-50 py-12">
        <div className="container-site max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-center">Volunteer with Us</h1>
          <p className="text-center text-neutral-600 mt-3 mb-8">
            Camp Celebrate volunteers: $495 per week, and worth every minute.
          </p>
          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6 mb-6">
            <h2 className="text-lg font-bold mb-3">How volunteering works</h2>
            <ol className="list-decimal pl-5 space-y-2 text-neutral-700">
              <li>
                <span className="font-semibold">Create an account</span> (or log in) — it takes a
                minute.
              </li>
              <li>
                <span className="font-semibold">Register for the week</span> you want to serve,
                choosing the role <span className="font-semibold">Volunteer</span>. Coming with
                your family? One registration covers everyone. Coming solo? Register just
                yourself.
              </li>
              <li>
                <span className="font-semibold">Complete the short application</span> on this page
                — where you&rsquo;d like to serve, and a little about you. Our team reviews it and
                follows up about the background check.
              </li>
            </ol>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/account/?next=/register/volunteer/" className="btn-primary">
              Log in / create an account
            </Link>
            <Link href="/volunteer-information" className="btn-outline">
              What volunteers do
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const supabase = await createClient();

  // Which household(s) this login belongs to, by membership — the same
  // explicit scoping every account page uses; RLS is the backstop.
  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  const householdIds = (memberships ?? []).map((m) => m.household_id);

  const { data: registrations } = householdIds.length
    ? await supabase
        .from('registrations')
        .select(
          `id,
           events ( id, name, starts_on, ends_on ),
           registration_participants ( id, camp_role, status,
             people ( id, first_name, last_name, date_of_birth ) )`
        )
        .in('household_id', householdIds)
        .order('created_at', { ascending: false })
    : { data: [] };

  // Every registered volunteer in the household, newest event first.
  const volunteers = [];
  for (const r of registrations ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (p.camp_role !== 'volunteer' || p.status === 'cancelled') continue;
      volunteers.push({ participant: p, event: r.events });
    }
  }

  // ---- Registered, but nobody has the Volunteer role yet. ----
  if (volunteers.length === 0) {
    return (
      <section className="bg-neutral-50 py-12">
        <div className="container-site max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-center">Volunteer with Us</h1>
          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6 mt-8">
            <h2 className="text-lg font-bold mb-2">First, register for the week</h2>
            <p className="text-neutral-700 mb-4">
              The application attaches to a registration, so start there: register for the week
              you want to serve and choose the role{' '}
              <span className="font-semibold">Volunteer</span> for yourself. Registering your
              whole family in the same pass is fine — each person gets their own role. Then come
              back here (we&rsquo;ll also remind you on your dashboard).
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/register/family" className="btn-primary">
                Register now
              </Link>
              <Link href="/account/dashboard" className="btn-outline">
                My dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Existing applications for these volunteers.
  const volIds = volunteers.map((v) => v.participant.id);
  const { data: apps } = await supabase
    .from('volunteer_applications')
    .select(
      'registration_participant_id, first_time_volunteering, preferred_areas, church_attendance, faith_statement, relevant_skills, disability_experience, accompanying_adult_person_id, status'
    )
    .in('registration_participant_id', volIds);
  const appByPart = new Map((apps ?? []).map((a) => [a.registration_participant_id, a]));

  // Adults in the household, for a minor volunteer's accompanying adult.
  const { data: householdPeople } = await supabase
    .from('people')
    .select('id, first_name, last_name, date_of_birth')
    .in('household_id', householdIds);
  const isAdult = (dob) => {
    if (!dob) return true; // unknown DOB: let them be chosen; staff review catches oddities
    const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 86400000);
    return age >= 18;
  };
  const adults = (householdPeople ?? [])
    .filter((p) => isAdult(p.date_of_birth))
    .map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}` }));

  return (
    <section className="bg-neutral-50 py-12">
      <div className="container-site max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold text-center">Volunteer Application</h1>
        <p className="text-center text-neutral-600 mt-3 mb-8">
          A few short questions so we can place you well. Our team reviews every application and
          follows up about the background check — that paperwork happens separately, never on
          this site.
        </p>
        <div className="space-y-6">
          {volunteers.map(({ participant, event }) => (
            <VolunteerApplication
              key={participant.id}
              participantId={participant.id}
              personName={`${participant.people?.first_name ?? ''} ${participant.people?.last_name ?? ''}`.trim()}
              isMinor={participant.people?.date_of_birth ? !isAdult(participant.people.date_of_birth) : false}
              personId={participant.people?.id}
              eventName={`${event?.name ?? 'Event'} (${event?.starts_on ?? ''} – ${event?.ends_on ?? ''})`}
              existing={appByPart.get(participant.id) ?? null}
              adults={adults}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
