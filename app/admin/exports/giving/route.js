// GET /admin/exports/giving — every gift as a CSV download.
// Gated by the giving permission (not just registrar); RLS is the backstop.

import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

const esc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request) {
  const staff = await getStaff();
  if (!can(staff, 'giving')) {
    return new Response('Not permitted', { status: 403 });
  }

  // Same filters as the Giving page: the CSV matches the filtered screen.
  const url = new URL(request.url);
  const fFrom = url.searchParams.get('from') || '';
  const fTo = url.searchParams.get('to') || '';
  const fFund = url.searchParams.get('fund') || '';
  const fMethod = url.searchParams.get('method') || '';

  const supabase = await createClient();
  const { data: gifts } = await supabase
    .from('gifts')
    .select('donor_name, email, amount_cents, fund, method, status, received_on, created_at, note')
    .order('created_at');

  const giftDate = (g) => g.received_on ?? (g.created_at ?? '').slice(0, 10);
  const filtered = (gifts ?? []).filter(
    (g) =>
      (!fFrom || giftDate(g) >= fFrom) &&
      (!fTo || giftDate(g) <= fTo) &&
      (!fFund || g.fund === fFund) &&
      (!fMethod || g.method === fMethod)
  );

  const rows = [['Date', 'Donor', 'Email', 'Amount', 'Fund', 'Method', 'Status', 'Note']];
  for (const g of filtered) {
    rows.push([
      g.received_on ?? (g.created_at ?? '').slice(0, 10),
      g.donor_name ?? '',
      g.email ?? '',
      ((g.amount_cents ?? 0) / 100).toFixed(2),
      g.fund ?? '',
      g.method ?? '',
      g.status ?? '',
      g.note ?? '',
    ]);
  }

  // UTF-8 byte-order mark so Excel reads accents and dashes correctly.
  const csv = '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="luke14-giving-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
