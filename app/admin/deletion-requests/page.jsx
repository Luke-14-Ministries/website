import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can, bounceNonStaff } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import DeletionList from './DeletionList';

export const metadata = { title: 'Deletion Requests — Staff Admin' };

// Families asking for their medical information, or their whole account, to
// be deleted (Lawrence, 30 Sep 2026). A queue, like cancellations: closing a
// request here records what a person did -- it deletes nothing by itself.
// Retention policy (not published): records are kept three years after a
// family's last event; payments, signed releases and background checks are
// what usually has to stay.
export default async function DeletionRequestsPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) await bounceNonStaff('/admin/deletion-requests/');
  if (!can(staff, 'registrar')) redirect('/admin');
  const showClosed = params?.closed === '1';

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('data_deletion_requests')
    .select('id, household_id, scope, family_note, status, staff_note, created_at, households ( display_name, email, phone )')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Deletion requests: ${error.message}`);

  const shaped = (rows ?? [])
    .filter((r) => (showClosed ? r.status !== 'requested' : r.status === 'requested'))
    .map((r) => ({
      id: r.id,
      householdId: r.household_id,
      household: r.households?.display_name ?? 'Household',
      email: r.households?.email ?? '',
      phone: r.households?.phone ?? '',
      scope: r.scope,
      familyNote: r.family_note,
      status: r.status,
      staffNote: r.staff_note,
      createdAt: r.created_at,
    }));

  return (
    <div>
      <h1 className="text-2xl font-bold">Deletion requests</h1>
      <p className="mt-1 mb-4 text-sm text-neutral-600">
        Families asking us to delete their medical information or their account. Contact the
        family, delete what can go, and note what was kept and why. Payments, signed releases and
        background checks are kept for three years.
      </p>
      <p className="mb-4 text-sm">
        <Link href={showClosed ? '/admin/deletion-requests' : '/admin/deletion-requests?closed=1'} className="text-brand underline">
          {showClosed ? 'Show open requests' : 'Show closed requests'}
        </Link>
      </p>
      <DeletionList rows={shaped} />
    </div>
  );
}
