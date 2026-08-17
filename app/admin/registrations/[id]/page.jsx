import { notFound, redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import RegistrationManager from './RegistrationManager';

export const metadata = { title: 'Registration — Staff Admin' };

// One family's registration, for a registrar to review and manage. Everything
// read here comes back under row-level security as staff, so a registrar sees
// the whole ministry; the write actions live in ./actions.js.
export default async function RegistrationDetailPage({ params }) {
  // In Next.js 15 params is a promise.
  const { id } = await params;

  const staff = await getStaff();
  if (!staff) redirect(`/account/?next=/admin/registrations/${id}/`);
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();

  const { data: reg } = await supabase
    .from('registrations')
    .select(
      `id, family_notes, created_at,
       households ( id, display_name, email, phone,
                    address_line1, address_line2, city, state, postal_code ),
       events ( id, name, starts_on, ends_on ),
       registration_participants (
         id, camp_role, status, fee_cents, scholarship_cents, discount_cents,
         people ( id, first_name, last_name, preferred_name, date_of_birth,
                  gender, email, phone )
       )`
    )
    .eq('id', id)
    .maybeSingle();

  if (!reg) notFound();

  // Camp options for this event, so a staff member adding a person can pick the
  // one that sets the fee.
  const { data: options } = await supabase
    .from('event_options')
    .select('id, name, participant_role, fee_cents, early_bird_fee_cents, early_bird_ends_on')
    .eq('event_id', reg.events?.id)
    .order('sort_order');

  // The scholarship/discount record: who granted what, and when. One row per
  // participant (upserted by setAdjustments), with the granting staff member's
  // name looked up separately — nested joins with two FKs to profiles are
  // fragile, so keep the lookups simple.
  const partIds = (reg.registration_participants ?? []).map((p) => p.id);
  let adjustmentRecords = [];
  if (partIds.length) {
    const { data: schols } = await supabase
      .from('scholarships')
      .select('registration_participant_id, granted_cents, status, family_statement, reviewed_by, reviewed_at, updated_at')
      .in('registration_participant_id', partIds);
    const reviewerIds = [...new Set((schols ?? []).map((s) => s.reviewed_by).filter(Boolean))];
    let names = new Map();
    if (reviewerIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', reviewerIds);
      names = new Map((profs ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`.trim()]));
    }
    adjustmentRecords = (schols ?? []).map((s) => ({
      participantId: s.registration_participant_id,
      grantedCents: s.granted_cents,
      status: s.status,
      note: s.family_statement,
      grantedBy: names.get(s.reviewed_by) ?? null,
      at: s.reviewed_at ?? s.updated_at,
    }));
  }

  // Notes TO the family (short staff messages shown on their dashboard),
  // newest first, with author names looked up separately.
  const { data: msgs } = await supabase
    .from('registration_family_messages')
    .select('id, body, created_by, created_at')
    .eq('registration_id', id)
    .order('created_at', { ascending: false });
  const authorIds = [...new Set((msgs ?? []).map((m) => m.created_by).filter(Boolean))];
  let authorNames = new Map();
  if (authorIds.length) {
    const { data: authors } = await supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', authorIds);
    authorNames = new Map((authors ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`.trim()]));
  }
  const familyMessages = (msgs ?? []).map((m) => ({
    id: m.id,
    body: m.body,
    author: authorNames.get(m.created_by) ?? 'Staff',
    at: (m.created_at ?? '').slice(0, 10),
  }));

  // Reshape the PostgREST nesting into the names the client component expects.
  const registration = {
    id: reg.id,
    family_notes: reg.family_notes,
    household: reg.households,
    event: reg.events,
    participants: (reg.registration_participants ?? [])
      .map((p) => ({
        id: p.id,
        camp_role: p.camp_role,
        status: p.status,
        fee_cents: p.fee_cents,
        scholarship_cents: p.scholarship_cents,
        discount_cents: p.discount_cents,
        person: p.people,
      }))
      .sort((a, b) =>
        `${a.person?.last_name} ${a.person?.first_name}`.localeCompare(
          `${b.person?.last_name} ${b.person?.first_name}`
        )
      ),
  };

  return <RegistrationManager registration={registration} options={options ?? []} adjustmentRecords={adjustmentRecords} familyMessages={familyMessages} />;
}
