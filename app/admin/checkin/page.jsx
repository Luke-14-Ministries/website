import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import CheckinList from './CheckinList';
import MedicalContact from './MedicalContact';

export const metadata = { title: 'Check-In — Staff Admin' };

// Day-of arrivals, built for a phone at the door. Registrars, coordinators and
// admins can mark people in (the set_check_in RPC is the real gate). Medical
// quick-flags appear only for staff holding the sensitive permission -- RLS
// simply returns nothing for anyone else.
export default async function CheckinPage({ searchParams }) {
  const params = await searchParams;

  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/checkin/');
  if (!can(staff, 'door')) redirect('/admin');

  const supabase = await createClient();
  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, medical_contact_name, medical_contact_phone')
    .order('starts_on');
  const eventsList = events ?? [];
  const eventId =
    typeof params?.event === 'string' && eventsList.some((e) => e.id === params.event)
      ? params.event
      : eventsList[0]?.id;

  let rows = [];
  if (eventId) {
    // Photo preference is read alongside the medical flags but kept SEPARATE
    // from them on purpose: the medical flags come back empty for staff
    // without the sensitive grant, whereas anyone working the door needs to
    // know who not to photograph. Bundling the two would hide it from most of
    // the people who need it.
    const [{ data: regs }, { data: consents }] = await Promise.all([
      supabase
        .from('registrations')
        .select(
          `id, event_id,
           households ( display_name ),
           registration_participants ( id, camp_role, status, checked_in_at,
             people ( id, first_name, last_name,
               person_support ( buddy_required, has_allergies, has_seizures, has_rescue_medication ) ) )`
        )
        .eq('event_id', eventId),
      supabase.from('person_current_consents').select('person_id, granted').eq('kind', 'media'),
    ]);

    const noPhotoIds = new Set(
      (consents ?? []).filter((c) => c.granted === false).map((c) => c.person_id)
    );

    // Identification thumbnails — the point of the photo. Readable by ANY
    // active staff member since 0033, because the door volunteers who need it
    // rarely hold the sensitive grant, and a photo they cannot see does not do
    // the job it exists to do. The bucket itself stays private: every view is
    // a signed URL minted here, for this request, expiring within the hour.
    const { data: photoRows } = await supabase
      .from('person_photos')
      .select('person_id, storage_path');
    const photoUrlOf = new Map();
    for (const row of photoRows ?? []) {
      if (!row.storage_path) continue;
      const { data: signed } = await supabase.storage
        .from('person-photos')
        .createSignedUrl(row.storage_path, 3600);
      if (signed?.signedUrl) photoUrlOf.set(row.person_id, signed.signedUrl);
    }

    for (const r of regs ?? []) {
      for (const p of r.registration_participants ?? []) {
        if (p.status === 'cancelled' || p.status === 'draft') continue;
        const s = p.people?.person_support ?? null;
        const flags = [];
        if (s?.has_allergies) flags.push('allergies');
        if (s?.has_seizures) flags.push('seizures');
        if (s?.has_rescue_medication) flags.push('rescue med');
        if (s?.buddy_required) flags.push('buddy');
        rows.push({
          id: p.id,
          name: `${p.people?.first_name ?? ''} ${p.people?.last_name ?? ''}`.trim(),
          sortName: `${p.people?.last_name ?? ''} ${p.people?.first_name ?? ''}`,
          role: p.camp_role,
          household: r.households?.display_name ?? '',
          checkedInAt: p.checked_in_at,
          flags,
          noPhoto: p.people?.id ? noPhotoIds.has(p.people.id) : false,
          photoUrl: p.people?.id ? photoUrlOf.get(p.people.id) ?? null : null,
        });
      }
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Check-In</h2>
      <p className="text-sm text-neutral-500 mb-4">
        Mark arrivals as people come through the door. Works on a phone. Red flags are the
        at-a-glance alerts; full detail lives on the Medical &amp; Support page.
      </p>

      {eventsList.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {eventsList.map((ev) => (
            <Link
              key={ev.id}
              href={`/admin/checkin?event=${ev.id}`}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold border ${
                ev.id === eventId
                  ? 'bg-brand text-white border-brand'
                  : 'border-neutral-300 text-neutral-700 hover:border-brand'
              }`}
            >
              {ev.name}
            </Link>
          ))}
        </div>
      )}

      {eventId && (
        <MedicalContact
          eventId={eventId}
          name={eventsList.find((e) => e.id === eventId)?.medical_contact_name}
          phone={eventsList.find((e) => e.id === eventId)?.medical_contact_phone}
          canEdit={can(staff, 'admin')}
        />
      )}

      {rows.length === 0 ? (
        <p className="text-neutral-500">Nobody to check in for this event yet.</p>
      ) : (
        <CheckinList rows={rows} />
      )}
    </div>
  );
}
