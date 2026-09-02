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

  // Parsed by parts, never through new Date(iso): a date-only string is UTC
  // midnight and renders as the day before in every US timezone.
  const fmtRange = (a, b) => {
    const one = (iso) => {
      if (!iso) return '';
      const [y, m, d] = String(iso).split('-').map(Number);
      if (!y) return '';
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    };
    const from = one(a);
    const to = one(b);
    return from ? `${from}${to && to !== from ? `–${to}` : ''}` : '';
  };

  const supabase = await createClient();
  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on, medical_contact_name, medical_contact_phone')
    .order('starts_on');
  // Check-In deliberately keeps a pill row rather than the searchable picker:
  // it is used standing at a door on a phone, and typing is the wrong
  // interaction there. But it had no date bounds at all, so every event the
  // ministry has ever run was a pill. Same two edges as everywhere else
  // (25 Aug): a 30-day grace behind, twelve months ahead.
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 1);
  const horizonISO = horizon.toISOString().slice(0, 10);
  const eventsList = (events ?? []).filter(
    (e) =>
      (e.ends_on ?? e.starts_on ?? '9999') >= cutoff &&
      (e.starts_on ?? e.ends_on ?? '0000') <= horizonISO
  );
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

    // Who is paired with whom. Staff see assignments whether or not they have
    // been published -- publication gates the FAMILY's view, not the door's.
    const { data: buddyRows } = await supabase
      .from('buddy_assignments')
      .select(
        `camper_participant_id,
         buddy:registration_participants!buddy_assignments_buddy_participant_id_fkey (
           people ( first_name, last_name ) )`
      )
      .eq('event_id', eventId)
      .is('ended_at', null);

    const buddyNamesOf = new Map();
    for (const b of buddyRows ?? []) {
      const n = `${b.buddy?.people?.first_name ?? ''} ${b.buddy?.people?.last_name ?? ''}`.trim();
      if (!n) continue;
      if (!buddyNamesOf.has(b.camper_participant_id)) {
        buddyNamesOf.set(b.camper_participant_id, []);
      }
      buddyNamesOf.get(b.camper_participant_id).push(n);
    }

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
        // Colour semantics, applied portal-wide (24 Aug): RED is a medical
        // alert -- something staff may need to act on in the moment. AMBER is
        // an operational note. "Needs buddy" is planning, not an emergency,
        // and the same pill was amber on Medical & Support -- one meaning,
        // one colour, everywhere.
        const flags = [];
        if (s?.has_allergies) flags.push({ t: 'allergies', tone: 'red' });
        if (s?.has_seizures) flags.push({ t: 'seizures', tone: 'red' });
        if (s?.has_rescue_medication) flags.push({ t: 'rescue med', tone: 'red' });
        // Buddy state is TWO pills, not one (agreed 24 Aug). An assigned
        // buddy is a fact worth knowing -- grey, carrying the name, because
        // "who?" is the question staff actually have. An unassigned one is
        // work outstanding -- amber. Sharing a colour is precisely what
        // would let a missing assignment hide among the finished ones.
        if (s?.buddy_required) {
          const names = buddyNamesOf.get(p.id) ?? [];
          if (names.length > 0) {
            flags.push({
              t: `Buddy: ${names.join(', ')}`,
              tone: 'neutral',
              title: 'The buddy assigned to this person for the week.',
            });
          } else {
            flags.push({
              t: 'no buddy assigned',
              tone: 'amber',
              title:
                'This person asked for a one-to-one buddy and none is assigned yet. Pairing is done by staff on the Buddy Assignments page.',
            });
          }
        }
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
              {/* The dates on the pill: at a door, "Week 1" and "Week 2" look
                  identical until you can see which week is which. */}
              <span className="flex flex-col leading-tight">
                <span>{ev.name}</span>
                {ev.starts_on && (
                  <span className="text-xs font-normal opacity-75">
                    {fmtRange(ev.starts_on, ev.ends_on)}
                  </span>
                )}
              </span>
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
