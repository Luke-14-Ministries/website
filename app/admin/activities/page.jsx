import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Activities — Staff Admin' };

const MODE_LABEL = {
  interest: 'Interest only',
  signup: 'Places held',
  appointment: 'By appointment',
};

// Who is doing what, per event. Read-only for now, deliberately: staff asked
// for activity signups so they could PLAN -- know the numbers, ring the
// stable, print a list. Creating and editing activities is the Setup work,
// which is lower priority than knowing who signed up for the ones that exist.
export default async function AdminActivitiesPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/activities/');
  if (!can(staff, 'coordinator')) redirect('/admin');

  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on')
    .order('starts_on');

  // Same archiving convention as the rest of the staff portal: current and
  // upcoming by default, past one click away, nothing hidden in the database.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const showPast = params?.past === '1';
  const visibleEvents = (events ?? []).filter((e) => showPast || (e.ends_on ?? '9999') >= cutoff);
  const selected = params?.event || visibleEvents[0]?.id || null;

  const { data: activities } = selected
    ? await supabase
        .from('activities')
        .select('id, name, description, booking_mode, capacity, provider_name, provider_url, active')
        .eq('event_id', selected)
        // Inactive last. Staff see activities families cannot (that is the
        // point of the "not open" badge), but interleaving them made the two
        // lists read as disagreeing with each other -- reported 25 Aug as the
        // staff section "not lining up with the wizard". Same set, same order,
        // with the ones families cannot see sitting plainly at the bottom.
        .order('active', { ascending: false })
        .order('sort_order')
    : { data: [] };

  const activityIds = (activities ?? []).map((a) => a.id);

  // Staff RLS on activity_signups is is_staff(), so this reads everyone --
  // which is the point of the page.
  const { data: signups } = activityIds.length
    ? await supabase
        .from('activity_signups')
        .select(
          `activity_id, status, waiver_acknowledged_at, added_source,
           registration_participants ( id, camp_role,
             people ( first_name, last_name ),
             registrations ( households ( display_name ) ) )`
        )
        .in('activity_id', activityIds)
    : { data: [] };

  const byActivity = new Map();
  for (const s of signups ?? []) {
    if (s.status === 'cancelled') continue;
    if (!byActivity.has(s.activity_id)) byActivity.set(s.activity_id, []);
    byActivity.get(s.activity_id).push({
      name: `${s.registration_participants?.people?.first_name ?? ''} ${
        s.registration_participants?.people?.last_name ?? ''
      }`.trim(),
      household: s.registration_participants?.registrations?.households?.display_name ?? '',
      status: s.status,
      acknowledged: Boolean(s.waiver_acknowledged_at),
      source: s.added_source,
    });
  }
  for (const list of byActivity.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Activities</h2>
      <p className="text-sm text-neutral-500 mb-4">
        What each family has chosen. Numbers here are what to give the stable, the boat, and
        the outfitter.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {visibleEvents.map((e) => (
          <Link
            key={e.id}
            href={`/admin/activities?event=${e.id}${showPast ? '&past=1' : ''}`}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              e.id === selected
                ? 'bg-brand text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {e.name}
          </Link>
        ))}
        <Link
          href={`/admin/activities?${selected ? `event=${selected}&` : ''}${showPast ? '' : 'past=1'}`}
          className="text-sm text-brand underline ml-2"
        >
          {showPast ? 'Hide past events' : 'Show past events'}
        </Link>
      </div>

      {(activities ?? []).length === 0 ? (
        <p className="text-neutral-500">No activities are set up for this event yet.</p>
      ) : (
        <div className="space-y-4">
          {(activities ?? []).map((a) => {
            const people = byActivity.get(a.id) ?? [];
            const signedUp = people.filter((p) => p.status === 'signed_up').length;
            const over = a.capacity != null && signedUp > a.capacity;
            return (
              <div key={a.id} className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold">
                    {a.name}
                    {!a.active && (
                      <span className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-600">
                        not open
                      </span>
                    )}
                  </h3>
                  <span className="text-sm text-neutral-500">
                    {MODE_LABEL[a.booking_mode] ?? a.booking_mode}
                    {a.capacity != null && (
                      <>
                        {' · '}
                        <span className={over ? 'font-semibold text-amber-700' : ''}>
                          {signedUp} of {a.capacity}
                          {over ? ' — over capacity' : ''}
                        </span>
                      </>
                    )}
                  </span>
                </div>

                {a.provider_name && (
                  <p className="mt-1 text-sm text-amber-800">
                    Outside provider: {a.provider_name}. Their own waiver is the family&rsquo;s
                    to complete — the ticks below record only that we told them.
                  </p>
                )}

                {people.length === 0 ? (
                  <p className="mt-3 text-sm text-neutral-500">Nobody yet.</p>
                ) : (
                  <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                    {people.map((p, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-neutral-500">{p.household}</span>
                        {p.status === 'interested' && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                            interested
                          </span>
                        )}
                        {a.provider_name && p.status === 'signed_up' && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              p.acknowledged
                                ? 'bg-neutral-100 text-neutral-600'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                            title={
                              p.acknowledged
                                ? 'Family confirmed they know the provider has their own form'
                                : 'Family has NOT confirmed they know about the provider form'
                            }
                          >
                            {p.acknowledged ? 'told' : 'not told'}
                          </span>
                        )}
                        {p.source === 'staff' && (
                          <span className="text-xs text-neutral-400">added by staff</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
