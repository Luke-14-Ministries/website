import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Rosters — Staff Admin' };

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

const STATUS_CLS = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-amber-100 text-amber-800',
  waitlisted: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-500',
};

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US')}`;

export default async function RostersPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/rosters/');
  // Rosters are a registrar (or admin) view.
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();

  const [{ data: events }, { data: regs }] = await Promise.all([
    supabase.from('events').select('id, name, starts_on, ends_on').order('starts_on'),
    supabase
      .from('registrations')
      .select(
        `id, event_id, family_notes,
         households ( display_name, email, phone ),
         registration_participants ( camp_role, status, fee_cents, people ( first_name, last_name ) )`
      )
      .order('created_at'),
  ]);

  const eventsList = events ?? [];
  const regsByEvent = new Map();
  for (const r of regs ?? []) {
    if (!regsByEvent.has(r.event_id)) regsByEvent.set(r.event_id, []);
    regsByEvent.get(r.event_id).push(r);
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Rosters</h2>
      <p className="text-sm text-neutral-500 mb-6">
        Everyone registered, by camp week. Select a household to review it, change a status, or
        add and edit people. Medical and dietary detail lives on its own permission and will have
        dedicated pages.
      </p>

      {eventsList.length === 0 && <p className="text-neutral-500">No camp weeks published yet.</p>}

      {eventsList.map((ev) => {
        const list = regsByEvent.get(ev.id) ?? [];
        const people = list.flatMap((r) => r.registration_participants ?? []);
        return (
          <div key={ev.id} className="mb-10">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h3 className="text-lg font-bold">{ev.name}</h3>
              <span className="text-sm text-neutral-500">
                {list.length} {list.length === 1 ? 'family' : 'families'} · {people.length}{' '}
                {people.length === 1 ? 'person' : 'people'}
              </span>
            </div>

            {list.length === 0 ? (
              <p className="text-neutral-500 text-sm">No registrations yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-neutral-500">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Household</th>
                      <th className="px-4 py-2 font-semibold">Person</th>
                      <th className="px-4 py-2 font-semibold">Role</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                      <th className="px-4 py-2 font-semibold text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) =>
                      (r.registration_participants ?? []).map((p, i) => (
                        <tr key={r.id + '-' + i} className="border-t border-neutral-100 align-top">
                          <td className="px-4 py-2">
                            {i === 0 ? (
                              <div>
                                <Link
                                  href={`/admin/registrations/${r.id}`}
                                  className="font-medium text-brand underline"
                                >
                                  {r.households?.display_name}
                                </Link>
                                <div className="text-neutral-500">
                                  {r.households?.email}
                                  {r.households?.phone ? ` · ${r.households.phone}` : ''}
                                </div>
                              </div>
                            ) : (
                              <span className="text-neutral-300">↳</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {p.people?.first_name} {p.people?.last_name}
                          </td>
                          <td className="px-4 py-2">{ROLE_LABEL[p.camp_role] ?? p.camp_role}</td>
                          <td className="px-4 py-2">
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                STATUS_CLS[p.status] ?? STATUS_CLS.submitted
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right">{money(p.fee_cents)}</td>
                        </tr>
                      ))
                    )}
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
