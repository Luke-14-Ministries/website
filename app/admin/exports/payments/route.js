// GET /admin/exports/payments — every event payment as a CSV download.
// Registrar-gated; RLS is the backstop.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) {
    return new Response('Not permitted', { status: 403 });
  }

  const supabase = await createClient();
  const [{ data: pays }, { data: regs }] = await Promise.all([
    supabase
      .from('payments')
      .select('registration_id, amount_cents, fee_cover_cents, method, status, received_on, created_at, note')
      .order('created_at'),
    supabase.from('registrations').select('id, events ( name ), households ( display_name )'),
  ]);
  const regById = new Map((regs ?? []).map((r) => [r.id, r]));

  const rows = [
    ['Date', 'Household', 'Event', 'Amount', 'Fee cover', 'Method', 'Status', 'Note'],
  ];
  for (const p of pays ?? []) {
    const r = regById.get(p.registration_id);
    rows.push([
      p.received_on ?? (p.created_at ?? '').slice(0, 10),
      r?.households?.display_name ?? '',
      r?.events?.name ?? '',
      ((p.amount_cents ?? 0) / 100).toFixed(2),
      ((p.fee_cover_cents ?? 0) / 100).toFixed(2),
      p.method ?? '',
      p.status ?? '',
      p.note ?? '',
    ]);
  }

  // UTF-8 byte-order mark so Excel reads accents and dashes correctly.
  const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="luke14-event-payments-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
