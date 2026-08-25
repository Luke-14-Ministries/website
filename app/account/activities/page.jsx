import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import ActivityPicker from './ActivityPicker';
import BackBar from '@/components/BackBar';

export const metadata = { title: 'Activities — Luke 14 Ministries' };

// Activity choices, one section per event, one card per attending person.
//
// Deliberately its own page rather than another card on the dashboard: a
// family with three people and eleven activities is a lot of screen, and the
// dashboard's job is "what needs my attention", not "everything I might do".
// The dashboard links here per registration.
export default async function ActivitiesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/account/?next=/account/activities/');

  const supabase = await createClient();

  const { data: memberships } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('profile_id', user.id);
  const householdIds = (memberships ?? []).map((m) => m.household_id);

  const { data: registrations } = householdIds.length
    ? await supabase
        .from('registrations')
        .select(
          `id, events ( id, name, starts_on, ends_on ),
           registration_participants ( id, status, people ( id, first_name, last_name ) )`
        )
        .in('household_id', householdIds)
        .order('created_at', { ascending: false })
    : { data: [] };

  const regs = registrations ?? [];
  const eventIds = [...new Set(regs.map((r) => r.events?.id).filter(Boolean))];

  // Activities for exactly the events this family is attending. RLS also hides
  // inactive ones and unpublished events, so this cannot show something the
  // ministry has not opened.
  const { data: activityRows } = eventIds.length
    ? await supabase
        .from('activities')
        .select(
          'id, event_id, name, description, booking_mode, capacity, fee_cents, provider_name, provider_url, signup_opens_at, signup_closes_at'
        )
        .in('event_id', eventIds)
        .eq('active', true)
        .order('sort_order')
    : { data: [] };

  const participantIds = regs.flatMap((r) =>
    (r.registration_participants ?? []).map((p) => p.id)
  );

  const { data: signupRows } = participantIds.length
    ? await supabase
        .from('activity_signups')
        .select('registration_participant_id, activity_id, status, waiver_acknowledged_at')
        .in('registration_participant_id', participantIds)
    : { data: [] };

  // How full each activity is. The function returns counts only -- a family
  // cannot read other families' signups, and does not need to.
  const takenByActivity = new Map();
  for (const eventId of eventIds) {
    const { data: avail } = await supabase.rpc('activity_availability', { p_event_id: eventId });
    for (const row of avail ?? []) takenByActivity.set(row.activity_id, row.taken);
  }

  const chosen = new Map();
  for (const s of signupRows ?? []) {
    chosen.set(`${s.registration_participant_id}:${s.activity_id}`, s);
  }

  const sections = regs
    .map((r) => {
      const activities = (activityRows ?? [])
        .filter((a) => a.event_id === r.events?.id)
        .map((a) => ({
          ...a,
          taken: takenByActivity.get(a.id) ?? 0,
          placesLeft: a.capacity == null ? null : Math.max(0, a.capacity - (takenByActivity.get(a.id) ?? 0)),
        }));
      const people = (r.registration_participants ?? [])
        .filter((p) => p.status !== 'cancelled')
        .map((p) => ({
          participantId: p.id,
          name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
          choices: Object.fromEntries(
            activities
              .map((a) => [a.id, chosen.get(`${p.id}:${a.id}`) ?? null])
              .filter(([, v]) => v)
          ),
        }));
      return { registrationId: r.id, event: r.events, activities, people };
    })
    .filter((s) => s.activities.length > 0 && s.people.length > 0);

  return (
    <section className="bg-neutral-50 py-12 min-h-[60vh]">
      <div className="container-site max-w-3xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
          <h1 className="text-3xl font-bold">Activities</h1>
          <Link href="/account/dashboard/" className="text-brand font-semibold text-sm">
            ← Back to dashboard
          </Link>
        </div>

        {sections.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-8 text-center text-neutral-600">
            <p>There are no activities to choose from yet.</p>
            <p className="mt-2 text-sm">
              Camp staff open these closer to each event — you&rsquo;ll find them here when
              they do.
            </p>
          </div>
        ) : (
          <>
            <p className="text-neutral-600 mb-8">
              Choose what each person would like to do. Nothing here is binding — tell us
              what you&rsquo;d like and camp staff will confirm the details closer to the
              time. You can change your mind whenever you like.
            </p>
            <div className="space-y-10">
              {sections.map((s) => (
                <div key={s.registrationId}>
                  <h2 className="text-xl font-bold mb-1">{s.event?.name}</h2>
                  <p className="text-sm text-neutral-500 mb-4">
                    {(s.event?.starts_on ?? '').slice(0, 10)} to {(s.event?.ends_on ?? '').slice(0, 10)}
                  </p>
                  <div className="space-y-6">
                    {s.people.map((p) => (
                      <ActivityPicker
                        key={p.participantId}
                        person={p}
                        activities={s.activities}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <BackBar />
      </div>
    </section>
  );
}
