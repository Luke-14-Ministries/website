import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import PrintButton from '@/components/PrintButton';

export const metadata = { title: 'Activity Sheets — Staff Admin' };

// E51: one printable sheet per activity, for the area leader.
//
// The kitchen has a printout and the roster has one; the person running archery
// had to read a screen and remember. This is the register they carry: who is
// signed up, for which sitting, with a box to tick them off.
//
// WHAT IT DELIBERATELY DOES NOT CARRY. No allergy text, no medications, no
// behaviour notes — a FLAG, and "ask the coordinator". That is the line 0061
// drew for program leaders and it holds here for the same two reasons: an area
// leader needs to know there is something to ask about rather than to read a
// child's medical history, and this sheet is paper. Paper gets left on a table.
//
// The columns holding the actual detail are not selected at all, so they cannot
// reach the page by accident later.
//
// Guarded on `coordinator`, matching the Activities page it prints from. Not
// `sensitive`: there is nothing here beyond names and a flag, and requiring it
// would put the register out of reach of the people who run the activities.

export default async function ActivityPrintPage({ searchParams }) {
  const params = await searchParams;

  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/activities/print/');
  if (!can(staff, 'coordinator')) redirect('/admin');

  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on')
    .order('starts_on');

  const selected =
    (typeof params?.event === 'string' && params.event) || events?.[0]?.id || null;
  const event = (events ?? []).find((e) => e.id === selected) ?? null;

  const { data: activities } = selected
    ? await supabase
        .from('activities')
        .select('id, name, description, capacity, active, sort_order')
        .eq('event_id', selected)
        .eq('active', true)
        .order('sort_order')
    : { data: [] };

  const activityIds = (activities ?? []).map((a) => a.id);

  const { data: slotRows } = activityIds.length
    ? await supabase
        .from('activity_slots')
        .select('id, activity_id, slot_date, start_time, end_time, label, capacity')
        .in('activity_id', activityIds)
        .order('slot_date')
        .order('start_time')
    : { data: [] };

  const { data: signups } = activityIds.length
    ? await supabase
        .from('activity_signups')
        .select(
          `activity_id, slot_id, status,
           registration_participants ( id, camp_role,
             people ( first_name, last_name, preferred_name,
               person_support ( has_allergies, has_seizures, has_rescue_medication, buddy_required ) ),
             registrations ( households ( display_name ) ) )`
        )
        .in('activity_id', activityIds)
    : { data: [] };

  const shape = (g) => {
    const rp = g.registration_participants;
    const pe = rp?.people;
    const s = Array.isArray(pe?.person_support) ? pe.person_support[0] : pe?.person_support;
    const base = `${pe?.first_name ?? ''} ${pe?.last_name ?? ''}`.trim();
    const preferred =
      pe?.preferred_name && pe.preferred_name !== pe.first_name ? pe.preferred_name : null;
    return {
      name: base || 'Unnamed',
      // The nametag name, shown beside the legal one rather than instead of it:
      // the leader is calling this person by name all afternoon (E45).
      preferred,
      household: rp?.registrations?.households?.display_name ?? '',
      role: rp?.camp_role,
      ask: Boolean(
        s?.has_allergies || s?.has_seizures || s?.has_rescue_medication || s?.buddy_required
      ),
    };
  };

  const bySlot = new Map();
  const byActivityNoSlot = new Map();
  for (const g of signups ?? []) {
    if (g.status === 'cancelled') continue;
    const row = shape(g);
    if (g.slot_id) {
      if (!bySlot.has(g.slot_id)) bySlot.set(g.slot_id, []);
      bySlot.get(g.slot_id).push(row);
    } else {
      if (!byActivityNoSlot.has(g.activity_id)) byActivityNoSlot.set(g.activity_id, []);
      byActivityNoSlot.get(g.activity_id).push(row);
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name);

  const slotsByActivity = new Map();
  for (const sl of slotRows ?? []) {
    if (!slotsByActivity.has(sl.activity_id)) slotsByActivity.set(sl.activity_id, []);
    slotsByActivity.get(sl.activity_id).push(sl);
  }

  const timeOf = (sl) =>
    [sl.slot_date, [sl.start_time, sl.end_time].filter(Boolean).join('–')]
      .filter(Boolean)
      .join(' · ');

  const Register = ({ rows }) =>
    rows.length === 0 ? (
      <p className="text-sm text-neutral-500">Nobody signed up.</p>
    ) : (
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-400">
            <th className="w-8 py-1">✓</th>
            <th className="py-1 pr-3">Name</th>
            <th className="py-1 pr-3">Family</th>
            <th className="py-1">Notes</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort(byName).map((r, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="py-1.5">
                <span className="inline-block h-3.5 w-3.5 border border-neutral-500" />
              </td>
              <td className="py-1.5 pr-3 font-medium">
                {r.name}
                {r.preferred && (
                  <span className="font-normal text-neutral-600"> &ldquo;{r.preferred}&rdquo;</span>
                )}
              </td>
              <td className="py-1.5 pr-3 text-neutral-600">{r.household}</td>
              <td className="py-1.5">
                {r.ask ? (
                  <span className="font-semibold">ask the coordinator</span>
                ) : (
                  <span className="text-neutral-400">&mdash;</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:p-0 print:text-[12px]">
      <div className="mb-2 flex items-center justify-between print:hidden">
        <h1 className="text-xl font-bold">Activity sheets</h1>
        <PrintButton />
      </div>
      <p className="mb-6 text-sm text-neutral-500 print:hidden">
        One register per activity, per sitting. Names and a flag only &mdash; the detail behind
        &ldquo;ask the coordinator&rdquo; stays on the Medical &amp; Support page, because this
        sheet is paper and paper gets left on a table.
      </p>

      <p className="mb-6 text-sm font-semibold">
        {event ? `${event.name} · ${event.starts_on} – ${event.ends_on}` : 'No event selected'}
      </p>

      {(activities ?? []).length === 0 && (
        <p className="text-sm text-neutral-500">No activities are open for this event.</p>
      )}

      {/* Each activity starts a new page: the leader carries one sheet, not a
          booklet with three other activities on the back of theirs. */}
      {(activities ?? []).map((a) => {
        const slots = slotsByActivity.get(a.id) ?? [];
        const loose = byActivityNoSlot.get(a.id) ?? [];
        return (
          <div key={a.id} className="mb-10 break-after-page last:break-after-auto">
            <h2 className="mb-1 border-b-2 border-neutral-800 pb-1 text-lg font-bold">{a.name}</h2>
            {a.description && <p className="mb-3 text-sm text-neutral-600">{a.description}</p>}

            {slots.length === 0 ? (
              <Register rows={loose} />
            ) : (
              slots.map((sl) => (
                <div key={sl.id} className="mb-5 break-inside-avoid">
                  <p className="mb-1 text-sm font-semibold">
                    {sl.label ? `${sl.label} — ` : ''}
                    {timeOf(sl)}
                    <span className="ml-2 font-normal text-neutral-500">
                      {(bySlot.get(sl.id) ?? []).length}
                      {sl.capacity ? ` of ${sl.capacity}` : ''} signed up
                    </span>
                  </p>
                  <Register rows={bySlot.get(sl.id) ?? []} />
                </div>
              ))
            )}

            {/* Somebody signed up to the activity but not to a sitting. They
                would otherwise appear on no sheet at all, which is the failure
                mode a paper register is meant to prevent. */}
            {slots.length > 0 && loose.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-sm font-semibold">No sitting chosen</p>
                <Register rows={loose} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
