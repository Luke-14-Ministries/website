import { redirect } from 'next/navigation';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';
import BackLink from '@/components/BackLink';
import ScreeningBoard from './ScreeningBoard';

export const metadata = { title: 'Background screening — Staff Admin' };

// Who is due a background check, and the two file moves that get them one.
//
// "Due" is deliberately narrow. It is adult volunteers on a registration for an
// event that has not finished, with no check on file or one that has expired.
// A wider net would be easy and wrong: every extra name is about $26.50 and a
// real person being asked for their Social Security number.
export default async function ScreeningPage() {
  const staff = await getStaff();
  if (!staff) redirect('/account/?next=/admin/volunteers/screening/');
  if (!can(staff, 'registrar')) redirect('/admin');

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // Events that have not finished. Screening someone for a week that is over
  // spends money to learn nothing.
  const { data: events } = await supabase
    .from('events')
    .select('id, name, starts_on, ends_on')
    .gte('ends_on', today);
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));
  const liveEventIds = [...eventById.keys()];

  if (liveEventIds.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 shadow-sm p-6">
        <BackLink href="/admin/volunteers" label="Back to Volunteers" />
        <h1 className="text-2xl font-bold mb-1">Background screening</h1>
        <p className="text-neutral-600">
          No upcoming events, so nobody is due a check for one.
        </p>
      </div>
    );
  }

  const { data: regs } = await supabase
    .from('registrations')
    .select(
      `id, event_id,
       registration_participants ( id, camp_role, status,
         people ( id, first_name, last_name, email, phone, date_of_birth ) )`
    )
    .in('event_id', liveEventIds);

  // One entry per PERSON, not per registration. Somebody volunteering at both
  // camp weeks needs one check, not two.
  const byPerson = new Map();
  for (const r of regs ?? []) {
    for (const p of r.registration_participants ?? []) {
      if (p.camp_role !== 'volunteer' || p.status === 'cancelled') continue;
      const person = p.people;
      if (!person?.id) continue;
      const ev = eventById.get(r.event_id);
      const seen = byPerson.get(person.id);
      if (seen) {
        if (ev?.name && !seen.events.includes(ev.name)) seen.events.push(ev.name);
        continue;
      }
      byPerson.set(person.id, { person, events: ev?.name ? [ev.name] : [] });
    }
  }

  const personIds = [...byPerson.keys()];
  const { data: clearances } = personIds.length
    ? await supabase
        .from('person_clearances')
        .select(
          'person_id, background_check_on_file, background_check_date, expires_on, checkr_status, invited_email, order_batch'
        )
        .in('person_id', personIds)
    : { data: [] };
  const clearanceBy = new Map((clearances ?? []).map((c) => [c.person_id, c]));

  const isAdult = (dob) => {
    if (!dob) return null;                       // null = unknown, not false
    const d = new Date(`${dob}T00:00:00Z`);
    const eighteen = new Date(d);
    eighteen.setUTCFullYear(eighteen.getUTCFullYear() + 18);
    return eighteen <= new Date();
  };

  const candidates = [];
  for (const [personId, { person, events: evNames }] of byPerson) {
    const c = clearanceBy.get(personId);
    const adult = isAdult(person.date_of_birth);

    // Already cleared and in date: not due, say nothing.
    if (c?.background_check_on_file && (!c.expires_on || c.expires_on >= today)) continue;
    // Already out with Checkr: not due again, but worth seeing.
    const waiting = c && ['invited', 'pending', 'suspended'].includes(c.checkr_status);

    // A minor is not "blocked", they are simply not screened -- Checkr will not
    // screen under-18s at all. Leave them out entirely rather than showing a
    // row a coordinator can do nothing about.
    if (adult === false) continue;

    let blockedBecause = null;
    if (adult === null) {
      blockedBecause =
        'no date of birth on file, so we cannot confirm they are 18 — add it on their details page';
    } else if (!(person.email || '').trim()) {
      blockedBecause = 'no email address on file, and Checkr needs one to send the invitation';
    } else if (waiting) {
      blockedBecause = `already invited${c.order_batch ? ` on ${c.order_batch.slice(0, 10)}` : ''} — waiting on Checkr`;
    }

    candidates.push({
      personId,
      name: `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Unnamed',
      email: (person.email || '').trim() || '—',
      eventName: evNames.join(' · ') || 'No event',
      status: c?.checkr_status ?? 'not_started',
      reason: c?.expires_on && c.expires_on < today
        ? `expired ${c.expires_on}`
        : c?.background_check_on_file
          ? 'on file but out of date'
          : 'never checked',
      blockedBecause,
    });
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="bg-white rounded-lg border border-neutral-200 shadow-sm p-6">
      <BackLink href="/admin/volunteers" label="Back to Volunteers" />
      <h1 className="text-2xl font-bold mb-1">Background screening</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-prose">
        Checkr&rsquo;s bulk upload takes a list of email addresses and invites each
        person to fill in their own details. We never see or hold a Social Security
        number, and there is no API key involved — the file is the whole integration.
      </p>
      <ScreeningBoard candidates={candidates} />
    </div>
  );
}
