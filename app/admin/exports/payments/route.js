// GET /admin/exports/payments — every event payment as a CSV download.
// Registrar-gated; RLS is the backstop.

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

  const url = new URL(request.url);
  const paystate = url.searchParams.get('paystate') || '';
  const eventFilter = url.searchParams.get('event') || '';

  const supabase = await createClient();
  const [{ data: pays }, { data: regs }, { data: balances }] = await Promise.all([
    supabase
      .from('payments')
      .select('registration_id, amount_cents, fee_cover_cents, method, status, received_on, created_at, note')
      .order('created_at'),
    supabase.from('registrations').select('id, events ( id, name ), households ( display_name )'),
    supabase
      .from('registration_balances')
      .select('registration_id, fee_cents, discount_cents, scholarship_cents, coupon_cents, paid_cents, balance_cents'),
  ]);
  const regById = new Map((regs ?? []).map((r) => [r.id, r]));

  // Same payment-state filter as the Event Payments page: the CSV matches
  // whatever pill was active when Download was clicked.
  let allowed = null;
  if (paystate) {
    allowed = new Set(
      (balances ?? [])
        .filter((b) => {
          const net = (b.fee_cents ?? 0) - (b.discount_cents ?? 0) - (b.scholarship_cents ?? 0) - (b.coupon_cents ?? 0);
          const paid = b.paid_cents ?? 0;
          const bal = b.balance_cents ?? 0;
          if (paystate === 'unpaid') return paid === 0 && bal > 0;
          if (paystate === 'partial') return paid > 0 && bal > 0;
          if (paystate === 'paid') return net > 0 && bal <= 0;
          if (paystate === 'scholarship') return (b.scholarship_cents ?? 0) > 0 || (b.discount_cents ?? 0) > 0;
          return true;
        })
        .map((b) => b.registration_id)
    );
  }

  const rows = [
    ['Date', 'Household', 'Event', 'Amount', 'Fee cover', 'Method', 'Status', 'Note'],
  ];
  for (const p of pays ?? []) {
    if (allowed && !allowed.has(p.registration_id)) continue;
    const r = regById.get(p.registration_id);
    if (eventFilter && r?.events?.id !== eventFilter) continue;
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
