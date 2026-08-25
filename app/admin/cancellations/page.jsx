import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import CancellationList from './CancellationList';

export const metadata = { title: 'Cancellation Requests — Staff Admin' };

// Families asking to cancel. A real queue, because a request with nobody
// watching it is worse than no request at all -- the family believes they have
// told someone.
//
// Marking one "actioned" here does NOT cancel the places or move any money.
// It records that staff have dealt with it. Releasing places is done on the
// registration itself, and refunds on the payment -- both deliberate acts with
// their own screens, because both are hard to undo.
export default async function CancellationsPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/cancellations/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const showHandled = params?.handled === '1';

  const supabase = await createClient();

  const { data: rows } = await supabase
    .from('registration_cancellation_requests')
    .select(
      `id, registration_id, participant_ids, reason, status, requested_at,
       handled_at, staff_note,
       registrations (
         id, households ( display_name, phone, email ),
         events ( name, starts_on ),
         registration_participants ( id, camp_role, status,
           people ( first_name, last_name ) )
       )`
    )
    .order('requested_at', { ascending: false });

  const all = rows ?? [];
  const open = all.filter((r) => r.status === 'open');
  const handled = all.filter((r) => r.status !== 'open');
  const shown = showHandled ? handled : open;

  const shaped = shown.map((r) => {
    const parts = r.registrations?.registration_participants ?? [];
    const named =
      (r.participant_ids ?? []).length === 0
        ? null
        : parts
            .filter((p) => r.participant_ids.includes(p.id))
            .map((p) => `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim())
            .filter(Boolean);
    return {
      id: r.id,
      registrationId: r.registration_id,
      household: r.registrations?.households?.display_name ?? 'Household',
      phone: r.registrations?.households?.phone ?? '',
      email: r.registrations?.households?.email ?? '',
      eventName: r.registrations?.events?.name ?? '',
      // null means the whole registration; the list says so in words rather
      // than showing an empty space.
      who: named,
      peopleCount: parts.filter((p) => p.status !== 'cancelled').length,
      reason: r.reason ?? '',
      status: r.status,
      requestedAt: r.requested_at,
      handledAt: r.handled_at,
      staffNote: r.staff_note ?? '',
    };
  });

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Cancellation Requests</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Families asking to cancel. Marking one handled records that you dealt with it — it
        does <strong>not</strong> release places or move money. Do those on the registration
        and the payment.
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          href="/admin/cancellations"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            !showHandled ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
          }`}
        >
          Open ({open.length})
        </Link>
        <Link
          href="/admin/cancellations?handled=1"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            showHandled ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
          }`}
        >
          Settled ({handled.length})
        </Link>
      </div>

      {shaped.length === 0 ? (
        <p className="text-neutral-500">
          {showHandled ? 'Nothing settled yet.' : 'No open requests — nothing waiting.'}
        </p>
      ) : (
        <CancellationList rows={shaped} />
      )}
    </div>
  );
}
