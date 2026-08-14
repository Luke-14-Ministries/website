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
         id, camp_role, status, fee_cents,
         people ( id, first_name, last_name, preferred_name, date_of_birth,
                  gender, pronouns, email, phone )
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
        person: p.people,
      }))
      .sort((a, b) =>
        `${a.person?.last_name} ${a.person?.first_name}`.localeCompare(
          `${b.person?.last_name} ${b.person?.first_name}`
        )
      ),
  };

  return <RegistrationManager registration={registration} options={options ?? []} />;
}
