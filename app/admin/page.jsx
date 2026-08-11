import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Overview — Staff Admin' };

const STATUSES = ['submitted', 'waitlisted', 'confirmed', 'draft', 'cancelled'];

export default async function AdminOverview() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/');

  const supabase = await createClient();

  // As staff, row-level security returns the whole ministry, not one household.
  const [{ data: regs }, { data: parts }] = await Promise.all([
    supabase.from('registrations').select('id, events ( name )'),
    supabase.from('registration_participants').select('status, registration_id'),
  ]);

  const registrations = regs ?? [];
  const participants = parts ?? [];

  const eventById = new Map();
  for (const r of registrations) eventById.set(r.id, r.events?.name ?? 'Unassigned');

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byEvent = new Map();
  for (const p of participants) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    const ev = eventById.get(p.registration_id) ?? 'Unassigned';
    byEvent.set(ev, (byEvent.get(ev) ?? 0) + 1);
  }

  const Stat = ({ label, value }) => (
    <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5">
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm text-neutral-500">{label}</div>
    </div>
  );

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Overview</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <Stat label="Registrations" value={registrations.length} />
        <Stat label="People registered" value={participants.length} />
        <Stat label="Confirmed" value={byStatus.confirmed} />
        <Stat label="Awaiting review" value={byStatus.submitted + byStatus.waitlisted} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h3 className="font-bold mb-3">By status</h3>
          <ul className="space-y-1 text-neutral-700">
            {STATUSES.map((s) => (
              <li key={s} className="flex justify-between">
                <span className="capitalize">{s}</span>
                <span className="font-semibold">{byStatus[s]}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h3 className="font-bold mb-3">By camp week</h3>
          {byEvent.size === 0 ? (
            <p className="text-neutral-500">No registrations yet.</p>
          ) : (
            <ul className="space-y-1 text-neutral-700">
              {[...byEvent.entries()].map(([ev, n]) => (
                <li key={ev} className="flex justify-between">
                  <span>{ev}</span>
                  <span className="font-semibold">{n}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/admin/rosters" className="btn-outline !py-2 mt-4 inline-block">
            View full rosters
          </Link>
        </div>
      </div>
    </div>
  );
}
