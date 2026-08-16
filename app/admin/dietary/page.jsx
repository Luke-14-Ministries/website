import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Dietary & Allergies — Staff Admin' };

// The kitchen view: who needs what at mealtimes, per event. Gated by the
// sensitive permission; can_view_person_support RLS is the real gate, so
// support rows simply don't come back for staff without it.
export default async function DietaryPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/dietary/');
  if (!can(staff, 'sensitive')) redirect('/admin');

  const supabase = await createClient();
  const [{ data: events }, { data: regs }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on').order('starts_on'),
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

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Dietary &amp; Allergies</h2>
      <p className="text-sm text-neutral-500 mb-6">
        Everyone with dietary needs or allergies, per event — the kitchen list. This page is a
        separate permission; treat printouts with the same care as the screen.
      </p>

      {(events ?? []).map((ev) => {
        const rows = (byEvent.get(ev.id) ?? []).sort((a, b) => a.sortName.localeCompare(b.sortName));
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
