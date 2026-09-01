import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import SetupManager from './SetupManager';
import { enrollmentOption } from '@/lib/events';

export const metadata = { title: 'Setup — Staff Admin' };

// The registration switchboard: which events exist, which are visible, and
// when each one's registration opens and closes. Admin-only; the events_write
// RLS policy (is_admin) is the real gate.
//
// This is Setup v1 -- registration control only, because that's what the
// ministry needs first (they open registration selectively, event by event).
// Creating events, editing prices, and payment schedules stay in SQL for now
// and join this page as the need arises.
export default async function SetupPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/setup/');
  if (!can(staff, 'admin')) redirect('/admin');

  // Staff read ALL events under RLS, published or not -- that's the point:
  // this page is where "unpublished" gets seen and changed.
  const supabase = await createClient();
  const { data: events } = await supabase
    .from('events')
    .select(
      'id, name, starts_on, ends_on, published, registration_opens_at, registration_closes_at, capacity, event_options ( id, fee_cents, published )'
    )
    .order('starts_on', { ascending: true });

  const rows = (events ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    startsOn: e.starts_on,
    endsOn: e.ends_on,
    published: e.published === true,
    opensAt: e.registration_opens_at,
    closesAt: e.registration_closes_at,
    capacity: e.capacity,
    // The enrollment option's fee (0069 published a second, zero-fee volunteer
    // option per event, and "the first published one" could return either).
    feeCents: enrollmentOption(e)?.fee_cents ?? null,
    hasPublishedOption: (e.event_options ?? []).some((o) => o.published),
  }));

  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-sm p-6">
      <h1 className="text-2xl font-bold mb-1">Setup</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-prose">
        Open and close registration, event by event. <span className="font-semibold">Visible</span>{' '}
        is the master switch — an event that isn&rsquo;t visible appears nowhere
        on the public site. The open/close times are optional refinements: leave
        them blank and a visible event takes registrations indefinitely; set
        them and registration opens and closes itself on schedule, no midnight
        clicking required.
      </p>
      <SetupManager events={rows} />
    </div>
  );
}
