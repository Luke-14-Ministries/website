import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import ScholarshipReview from './ScholarshipReview';

export const metadata = { title: 'Scholarship Requests — Staff Admin' };

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent / guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

// Families asking for help with the fee.
//
// The registration page now shows a family's request prominently when you open
// it -- but only when you open it, and nobody opens a registration to find out
// whether it is waiting on something. That is what a queue is for, and it is
// the same reason the cancellation queue exists: a request with nobody
// watching it is worse than no request at all, because the family believes
// they have told someone.
//
// Deliberately a sibling of /admin/cancellations rather than a tab inside it.
// The two drain differently -- a cancellation is settled by doing work
// elsewhere and ticking it off, a scholarship is settled right here by
// deciding an amount -- and folding them together would make one page that
// lies about half its rows.
export default async function ScholarshipRequestsPage({ searchParams }) {
  const params = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/scholarships/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const showSettled = params?.settled === '1';

  const supabase = await createClient();

  // !inner on both embeds so a request whose person has been removed from the
  // week stops appearing in the queue: there is nothing left to decide, and a
  // row a registrar cannot action is exactly how a queue becomes ignorable.
  const { data: rows, error } = await supabase
    .from('scholarships')
    .select(
      `id, registration_participant_id, requested_cents, granted_cents, status,
       family_statement, staff_note, reviewed_by, reviewed_at, created_at,
       registration_participants!inner (
         id, camp_role, status, fee_cents, discount_cents,
         people ( first_name, last_name ),
         registrations!inner (
           id,
           households ( display_name ),
           events ( name, starts_on )
         )
       )`
    )
    .neq('registration_participants.status', 'cancelled')
    .order('created_at', { ascending: true });

  // Surfaced, not swallowed. An empty page that means "the query failed" must
  // not look like an empty page that means "nothing is waiting" -- that
  // confusion cost a day on the household card.
  if (error) console.error('scholarship queue:', error.message);

  const all = rows ?? [];
  const open = all.filter((r) => r.status === 'requested');
  const settled = all.filter((r) => r.status !== 'requested');
  const shown = showSettled ? settled : open;

  // Reviewer names, looked up separately: two FKs from scholarships into
  // profiles would make a nested join ambiguous, and a flat lookup cannot
  // break.
  const reviewerIds = [...new Set(shown.map((r) => r.reviewed_by).filter(Boolean))];
  let names = new Map();
  if (reviewerIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', reviewerIds);
    names = new Map((profs ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));
  }

  const shaped = shown.map((r) => {
    const part = r.registration_participants ?? {};
    const reg = part.registrations ?? {};
    const person = part.people ?? {};
    return {
      participantId: part.id,
      registrationId: reg.id,
      name: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Person',
      roleLabel: ROLE_LABEL[part.camp_role] ?? part.camp_role ?? '',
      household: reg.households?.display_name ?? '',
      eventName: reg.events?.name ?? '',
      feeCents: part.fee_cents ?? 0,
      discountCents: part.discount_cents ?? 0,
      requestedCents: r.requested_cents,
      grantedCents: r.granted_cents ?? 0,
      status: r.status,
      familyStatement: r.family_statement ?? '',
      staffNote: r.staff_note ?? '',
      requestedAt: r.created_at,
      reviewedAt: r.reviewed_at,
      reviewedBy: names.get(r.reviewed_by) ?? null,
    };
  });

  // Settled reads newest-first (what happened lately); open reads oldest-first
  // (who has been waiting longest). Same list, two different questions.
  if (showSettled) shaped.reverse();

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Scholarship Requests</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Families asking for help with the fee. Approving one takes the amount straight off
        what that family owes — it shows on their balance, their dashboard, and their
        statement immediately.
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          href="/admin/scholarships"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            !showSettled
              ? 'bg-brand text-white'
              : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
          }`}
        >
          Waiting ({open.length})
        </Link>
        <Link
          href="/admin/scholarships?settled=1"
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            showSettled
              ? 'bg-brand text-white'
              : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
          }`}
        >
          Answered ({settled.length})
        </Link>
      </div>

      {shaped.length === 0 ? (
        <p className="text-neutral-500">
          {showSettled
            ? 'Nothing answered yet.'
            : 'No requests waiting — nobody is sitting without an answer.'}
        </p>
      ) : (
        <div className="space-y-4">
          {shaped.map((row) => (
            <ScholarshipReview key={row.participantId} row={row} showRegistrationLink />
          ))}
        </div>
      )}
    </div>
  );
}
