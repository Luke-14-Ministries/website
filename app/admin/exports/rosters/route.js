// GET /admin/exports/rosters — the full roster as a CSV download.
// Registrar-gated; RLS is the backstop. Data is never trapped in the app.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) {
    return new Response('Not permitted', { status: 403 });
  }

  // Filters mirror the on-screen roster browser, so the download always
  // matches what the person was looking at.
  const url = new URL(request.url);
  const fEvent = url.searchParams.get('event') || '';
  const fRole = url.searchParams.get('role') || '';
  const fStatus = url.searchParams.get('status') || '';

  const supabase = await createClient();
  const [{ data: regs }, { data: consents }, { data: sigs }] = await Promise.all([
    supabase
      .from('registrations')
      .select(
        `id, event_id, events ( name ),
         households ( display_name, email, phone, how_did_you_hear ),
         registration_participants ( camp_role, status, fee_cents, submitted_at, created_at, checked_in_at,
           tshirt_size, first_time_attending,
           people ( id, first_name, last_name, date_of_birth, gender ) )`
      ),
    supabase.from('person_current_consents').select('person_id, kind, granted'),
    supabase.from('agreement_signatures').select('registration_id, signed_at'),
  ]);

  const consentOf = new Map();
  for (const c of consents ?? []) consentOf.set(`${c.person_id}:${c.kind}`, c.granted);

  // Earliest signature on a registration is the date the family signed.
  const signedOn = new Map();
  for (const s of sigs ?? []) {
    if (!s.registration_id) continue;
    const prev = signedOn.get(s.registration_id);
    if (!prev || s.signed_at < prev) signedOn.set(s.registration_id, s.signed_at);
  }

  // Blank vs "no" matters here as much as on screen: an empty cell means we
  // never asked. A spreadsheet that rendered both as "no" would be worse than
  // not exporting the column at all.
  const yn = (v) => (v === true ? 'yes' : v === false ? 'no' : '');

  const rows = [
    ['Event', 'Household', 'Email', 'Phone', 'First name', 'Last name', 'Date of birth',
     'Sex', 'Role', 'Status', 'T-shirt', 'First time', 'Photos OK', 'In directory',
     'Agreements signed', 'How they heard', 'Fee', 'Submitted', 'Checked in'],
  ];
  for (const r of regs ?? []) {
    if (fEvent && r.event_id !== fEvent) continue;
    for (const p of r.registration_participants ?? []) {
      if (fRole && p.camp_role !== fRole) continue;
      if (fStatus && p.status !== fStatus) continue;
      rows.push([
        r.events?.name ?? '',
        r.households?.display_name ?? '',
        r.households?.email ?? '',
        r.households?.phone ?? '',
        p.people?.first_name ?? '',
        p.people?.last_name ?? '',
        p.people?.date_of_birth ?? '',
        p.people?.gender ?? '',
        p.camp_role ?? '',
        p.status ?? '',
        p.tshirt_size ?? '',
        yn(p.first_time_attending),
        yn(p.people?.id ? consentOf.get(`${p.people.id}:media`) : undefined),
        yn(p.people?.id ? consentOf.get(`${p.people.id}:directory`) : undefined),
        (signedOn.get(r.id) ?? '').slice(0, 10),
        r.households?.how_did_you_hear ?? '',
        ((p.fee_cents ?? 0) / 100).toFixed(2),
        (p.submitted_at ?? p.created_at ?? '').slice(0, 10),
        p.checked_in_at
          ? new Date(p.checked_in_at).toLocaleString('en-US', {
              timeZone: 'America/New_York',
              month: 'numeric',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })
          : '',
      ]);
    }
  }

  // \ufeff is the UTF-8 byte-order mark. Without it Excel guesses the wrong
  // encoding and renders em-dashes as "â€"" gibberish.
  const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="luke14-rosters-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
