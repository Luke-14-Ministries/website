import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import ScholarshipForm from './ScholarshipForm';

export const metadata = { title: 'Scholarship Request — Luke 14 Ministries' };

// Families ask for help with the fee here. Everything behind it already
// existed: the scholarships table, its policies, and the staff review screen
// on /admin/registrations/[id]. What was missing was the asking.
//
// Access is row-level security again: the registration query returns nothing
// for a registration outside the caller's household, so the page 404s.
export default async function ScholarshipPage({ params }) {
  const { registrationId } = await params;

  const user = await getCurrentUser();
  if (!user) redirect(`/account/?next=/account/scholarship/${registrationId}/`);

  const supabase = await createClient();

  const { data: reg } = await supabase
    .from('registrations')
    .select(
      `id, household_id,
       events ( name, starts_on ),
       registration_participants ( id, status, fee_cents,
         people ( first_name, last_name ) )`
    )
    .eq('id', registrationId)
    .maybeSingle();
  if (!reg) notFound();

  // The scholarship agreement moved here from the registration form (24 Aug):
  // it is signed at the moment it starts to apply, by the family it binds,
  // instead of by everyone. Load the current version's text, and whether this
  // household has already signed it for this registration.
  const [{ data: agreement }, { data: schAgSig }] = await Promise.all([
    supabase
      .from('agreements')
      .select('key, title, body, version')
      .eq('key', 'scholarship_agreement')
      .eq('active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('agreement_signatures')
      .select('id, signed_at, signer_name, agreements!inner ( key )')
      .eq('registration_id', registrationId)
      .eq('agreements.key', 'scholarship_agreement')
      .limit(1),
  ]);
  const agreementSigned = Boolean(schAgSig?.[0]);

  const parts = (reg.registration_participants ?? []).filter((p) => p.status !== 'cancelled');

  const { data: schols } = parts.length
    ? await supabase
        .from('scholarships')
        .select('registration_participant_id, requested_cents, granted_cents, status, family_statement')
        .in('registration_participant_id', parts.map((p) => p.id))
    : { data: [] };
  const byPart = new Map((schols ?? []).map((s) => [s.registration_participant_id, s]));

  const rows = parts.map((p) => {
    const s = byPart.get(p.id);
    return {
      participantId: p.id,
      name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim() || 'Person',
      feeCents: p.fee_cents ?? 0,
      requestedCents: s?.requested_cents ?? null,
      grantedCents: s?.granted_cents ?? 0,
      status: s?.status ?? null,
      statement: s?.family_statement ?? '',
    };
  });

  return (
    <section className="bg-neutral-50 py-12">
      <div className="container-site max-w-3xl mx-auto">
        <h1 className="text-4xl font-bold text-center">Help with the fee</h1>
        <p className="text-center text-neutral-700 mt-3 max-w-xl mx-auto">
          Luke 14 raises money so that cost is not the reason someone stays home. If the fee
          for {reg.events?.name ?? 'this event'} is difficult, please ask — it is an ordinary
          part of how camp works, and asking will not affect anyone&rsquo;s place.
        </p>
        <p className="text-center text-sm mt-4 mb-8">
          <Link href="/account/dashboard/" className="text-brand underline font-semibold">
            &larr; Back to my dashboard
          </Link>
        </p>

        <ScholarshipForm
          registrationId={reg.id}
          rows={rows}
          agreement={agreement}
          agreementSigned={agreementSigned}
        />

        <p className="text-center text-sm text-neutral-500 mt-8">
          Questions about paying? Email camp@luke14ministries.net or call the office.
        </p>
      </div>
    </section>
  );
}
