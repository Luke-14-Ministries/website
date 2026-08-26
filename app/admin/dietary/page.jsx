import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import EventFilter from '@/components/EventFilter';

export const metadata = { title: 'Dietary & Allergies — Staff Admin' };

// The kitchen view: who needs what at mealtimes, per event. Gated by the
// sensitive permission; can_view_person_support RLS is the real gate, so
// support rows simply don't come back for staff without it.
export default async function DietaryPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/dietary/');
  if (!can(staff, 'sensitive')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: events }, { data: regs }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on').order('starts_on'),
    supabase
      .from('registrations')
      .select(
        `id, event_id,
         households ( display_name, phone ),
         registration_participants ( camp_role, status,
           people ( first_name, last_name,
             person_support ( dietary_needs, allergy_detail, has_allergies ) ) )`
      ),
  ]);

  const byEvent = new Map();
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (p.status === 'cancelled') continue;
      const s = p.people?.person_support;
      if (!s) continue;
      if (!s.dietary_needs && !s.allergy_detail && !s.has_allergies) continue;
      if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []);
      byEvent.get(r.event_id).push({
        name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
        sortName: `${p.people?.last_name ?? ''} ${p.people?.first_name ?? ''}`,
        household: r.households?.display_name ?? '',
        phone: r.households?.phone ?? '',
        dietary: s.dietary_needs,
        allergies: s.allergy_detail,
        hasAllergies: s.has_allergies,
      });
    }
  }


  // ---- D4 (24 Aug): the page defaults to CURRENT AND UPCOMING events. Past
  // events stay one click away rather than accumulating on screen year after
  // year -- this is the portal-wide archiving convention: nothing is archived
  // in the database, display just defaults to what staff are working on.
  // A 30-day grace keeps a just-finished event visible while follow-up work
  // is still live.
  const eventFilter = typeof params?.event === 'string' ? params.event : '';
  // Past events are reached through EventFilter's search now, so selecting
  // one by id is the only way to see it -- there is no page-wide past mode.
  const showPast = false;
  const q = typeof params?.q === 'string' ? params.q.trim().toLowerCase() : '';
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const isCurrent = (ev) => (ev.ends_on ?? ev.starts_on ?? '') >= cutoff;
  const visibleEvents = (events ?? []).filter((ev) => {
    if (eventFilter) return ev.id === eventFilter;
    return showPast || isCurrent(ev);
  });
  const pastCount = (events ?? []).filter((ev) => !isCurrent(ev)).length;
  const matchesQ = (row) =>
    !q || row.name.toLowerCase().includes(q) || (row.household ?? '').toLowerCase().includes(q);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="text-xl font-bold">Dietary &amp; Allergies</h2>
        {/* The filter travels with the link. Printing "the kitchen list"
            from a page filtered to one week and getting every registrant the
            ministry has ever had is not a longer list — it is the wrong list,
            and the kitchen cannot tell (25 Aug). */}
        <a
          href={`/admin/dietary/print${
            eventFilter ? `?event=${eventFilter}` : showPast ? '?past=1' : ''
          }`}
          className="btn-outline !py-2 text-sm"
        >
          Kitchen list (no names)
          {eventFilter && <span className="font-normal"> — this event</span>}
        </a>
      </div>
      <p className="text-sm text-neutral-500 mb-6">
        Everyone with dietary needs or allergies, per event — the kitchen list. This page is a
        separate permission; treat printouts with the same care as the screen.
      </p>


      {/* One filter, shared with Activities, Buddies and Rooms (25 Aug).
          "All current events" stays, because a kitchen list is not per-week —
          it is what the kitchen is cooking for. */}
      <EventFilter
        events={(events ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
        }))}
        selected={eventFilter || null}
        basePath="/admin/dietary"
        extraParams={{ q }}
        allowAll
      />
      <form method="get" action="/admin/dietary" className="mb-6 flex flex-wrap items-center gap-2">
        {eventFilter && <input type="hidden" name="event" value={eventFilter} />}
        {showPast && <input type="hidden" name="past" value="1" />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Find a person or household…"
          className="w-64 rounded border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="btn-outline !py-1.5 text-sm">Search</button>
        {q && (
          <a href="/admin/dietary" className="text-sm text-brand underline">
            Clear
          </a>
        )}
      </form>

      {visibleEvents.map((ev) => {
        const rows = (byEvent.get(ev.id) ?? []).filter(matchesQ).sort((a, b) => a.sortName.localeCompare(b.sortName));
        return (
          <div key={ev.id} className="mb-10">
            <h3 className="text-lg font-bold mb-3">
              {ev.name} <span className="text-sm font-normal text-neutral-500">· {rows.length} people</span>
            </h3>
            {rows.length === 0 ? (
              <p className="text-neutral-500 text-sm">No dietary needs or allergies recorded.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-neutral-500">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Person</th>
                      <th className="px-4 py-2 font-semibold">Allergies</th>
                      <th className="px-4 py-2 font-semibold">Dietary needs</th>
                      <th className="px-4 py-2 font-semibold">Household / phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-neutral-100 align-top">
                        <td className="px-4 py-2 font-medium">
                          {r.name}
                          {r.hasAllergies && (
                            <span className="ml-2 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-semibold">
                              allergy
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-pre-wrap">{r.allergies || '—'}</td>
                        <td className="px-4 py-2 whitespace-pre-wrap">{r.dietary || '—'}</td>
                        <td className="px-4 py-2 text-neutral-600">
                          {r.household}
                          {r.phone ? ` · ${r.phone}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
