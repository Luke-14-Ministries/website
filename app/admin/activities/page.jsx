import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import { ActivityEditor, AddActivity, ActivityCard, SlotEditor, slotLabel } from './ActivityEditor';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Activities — Staff Admin' };

const MODE_LABEL = {
  interest: 'Interest only',
  signup: 'Places held',
  appointment: 'By appointment',
};

// Who is doing what, per event -- and, since 25 Aug, what is on offer at all.
//
// This was read-only on the reasoning that staff wanted the numbers, not the
// setup. Testing put that straight: camp changes what it offers, and "ask the
// web admin to activate the zip line" is not a process. Coordinators add,
// edit, turn off and remove activities here now.
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
  // Current-and-upcoming is what the page opens on; EventFilter owns the
  // rest, including reaching past events by search.
  // Same twelve-month horizon the pill row uses (EventFilter), so the event
  // this page OPENS on is always one that has a pill. Without it a week booked
  // three years out would be selected by default and appear nowhere.
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 1);
  const horizonISO = horizon.toISOString().slice(0, 10);
  const visibleEvents = (events ?? []).filter(
    (e) => (e.ends_on ?? '9999') >= cutoff && (e.starts_on ?? '0000') <= horizonISO
  );
  const selected = params?.event || visibleEvents[0]?.id || null;

  const { data: activities } = selected
    ? await supabase
        .from('activities')
        .select(
          'id, name, description, booking_mode, capacity, provider_name, provider_url, active, sort_order'
        )
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

  // Sittings, and how full each is. Ordered by the guard's own index so the
  // day reads in order.
  const { data: slotRows } = activityIds.length
    ? await supabase
        .from('activity_slots')
        .select('id, activity_id, slot_date, start_time, end_time, label, capacity')
        .in('activity_id', activityIds)
        .order('slot_date')
        .order('start_time')
    : { data: [] };

  // Staff RLS on activity_signups is is_staff(), so this reads everyone --
  // which is the point of the page.
  const { data: signups } = activityIds.length
    ? await supabase
        .from('activity_signups')
        .select(
          `activity_id, slot_id, status, waiver_acknowledged_at, added_source,
           registration_participants ( id, camp_role,
             people ( first_name, last_name ),
             registrations ( households ( display_name ) ) )`
        )
        .in('activity_id', activityIds)
    : { data: [] };

  const takenBySlot = new Map();
  for (const g of signups ?? []) {
    if (g.status === 'cancelled' || !g.slot_id) continue;
    takenBySlot.set(g.slot_id, (takenBySlot.get(g.slot_id) ?? 0) + 1);
  }
  const slotsByActivity = new Map();
  for (const sl of slotRows ?? []) {
    if (!slotsByActivity.has(sl.activity_id)) slotsByActivity.set(sl.activity_id, []);
    slotsByActivity.get(sl.activity_id).push({ ...sl, taken: takenBySlot.get(sl.id) ?? 0 });
  }
  const slotById = new Map((slotRows ?? []).map((sl) => [sl.id, sl]));

  const byActivity = new Map();
  for (const s of signups ?? []) {
    if (s.status === 'cancelled') continue;
    if (!byActivity.has(s.activity_id)) byActivity.set(s.activity_id, []);
    byActivity.get(s.activity_id).push({
      slotId: s.slot_id,
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
        What is on offer for each event, and who has chosen it. Numbers here are what to give
        the stable, the boat, and the outfitter.
      </p>

      <EventFilter
        events={(events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
        }))}
        selected={selected}
        basePath="/admin/activities"
      />

      {(activities ?? []).length === 0 ? (
        <p className="text-neutral-500 mb-4">
          Nothing is on offer for this event yet — add the first one below.
        </p>
      ) : (
        <div className="space-y-4">
          {(activities ?? []).map((a) => {
            const people = byActivity.get(a.id) ?? [];
            const signedUp = people.filter((p) => p.status === 'signed_up').length;
            const interested = people.filter((p) => p.status === 'interested').length;
            const over = a.capacity != null && signedUp > a.capacity;
            return (
              <ActivityCard
                key={a.id}
                name={a.name}
                active={a.active !== false}
                modeLabel={MODE_LABEL[a.booking_mode] ?? a.booking_mode}
                signedUp={signedUp}
                interested={interested}
                capacity={a.capacity}
                over={over}
              >

                {/* What the family actually reads. Its absence here is what
                    made this page and the family wizard look like two
                    different lists (25 Aug, reported twice): the wizard leads
                    with the description and staff could not see it at all, so
                    the same activity read as two different things. */}
                {a.description && (
                  <p className="mt-1 text-sm text-neutral-600">{a.description}</p>
                )}

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
                        {/* Which boat. Without it this list answers "how many"
                            and not "who is on the 2 o'clock", which is the
                            question the day is actually run from. */}
                        {p.slotId && slotById.get(p.slotId) && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-semibold text-neutral-700">
                            {slotLabel(slotById.get(p.slotId))}
                          </span>
                        )}
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

                <SlotEditor activity={a} slots={slotsByActivity.get(a.id) ?? []} />

                <ActivityEditor activity={a} />
              </ActivityCard>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="mt-6">
          <AddActivity
            eventId={selected}
            eventName={visibleEvents.find((e) => e.id === selected)?.name}
          />
        </div>
      )}
    </div>
  );
}
