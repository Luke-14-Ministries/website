'use server';

// Recording a mailed check or cash DONATION. Runs as the signed-in staff
// member; the gifts_manual_insert policy (migration 0010) is the real gate --
// it requires the giving grant (admin, or can_view_giving) and allows only the
// check/cash/other methods. Online gifts come exclusively from the Stripe
// webhook.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

const MANUAL_METHODS = ['check', 'cash', 'other'];

export async function recordManualGift({ donorName, email, amountCents, fund, method, receivedOn, note }) {
  const staff = await getStaff();
  if (!can(staff, 'giving')) {
    return { ok: false, error: 'You do not have permission to record gifts.' };
  }
  if (!MANUAL_METHODS.includes(method)) {
    return { ok: false, error: 'Method must be check, cash, or other.' };
  }
  const amt = Math.round(Number(amountCents));
  if (!Number.isFinite(amt) || amt < 1) {
    return { ok: false, error: 'Please enter an amount greater than zero.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('gifts').insert({
    donor_name: donorName?.trim() || null,
    email: email?.trim() || null,
    amount_cents: amt,
    fund: fund || 'General Operating Fund',
    method,
    status: 'succeeded',
    received_on: receivedOn || new Date().toISOString().slice(0, 10),
    recorded_by: staff.userId,
    note: note?.trim() ? note.trim() : null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/giving');
  return { ok: true };
}
