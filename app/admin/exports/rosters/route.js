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
  const { data: regs } = await supabase
    .from('registrations')
    .select(
      `id, event_id, events ( name ),
       households ( display_name, email, phone ),
       registration_participants ( camp_role, status, fee_cents, submitted_at, created_at, checked_in_at,
         people ( first_name, last_name, date_of_birth ) )`
    );

  const rows = [
    ['Event', 'Household', 'Email', 'Phone', 'First name', 'Last name', 'Date of birth',
     'Role', 'Status', 'Fee', 'Submitted', 'Checked in'],
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
        p.camp_role ?? '',
        p.status ?? '',
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
