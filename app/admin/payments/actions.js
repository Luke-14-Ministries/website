'use server';

// Recording a check or cash payment that arrived by hand. Runs as the signed-in
// registrar; the payments_manual_insert RLS policy is the real gate (it allows
// only registrars, and only the check/cash/other methods -- card and bank rows
// come exclusively from the Stripe webhook).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

const MANUAL_METHODS = ['check', 'cash', 'other'];

// A mailed check or cash gift -- very common for donations. Online gifts are
// recorded by the Stripe webhook; this is only for money that arrived by hand.
export async function recordManualGift({ donorName, email, amountCents, fund, method, receivedOn, note }) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) {
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

  revalidatePath('/admin/payments');
  return { ok: true };
}

export async function recordManualPayment({ registrationId, amountCents, method, receivedOn, note }) {
  const staff = await getStaff();
  if (!can(staff, 'registrar')) {
    return { ok: false, error: 'You do not have permission to record payments.' };
  }
  if (!registrationId) return { ok: false, error: 'Please choose a registration.' };
  if (!MANUAL_METHODS.includes(method)) {
    return { ok: false, error: 'Method must be check, cash, or other.' };
  }
  const amt = Math.round(Number(amountCents));
  if (!Number.isFinite(amt) || amt < 1) {
    return { ok: false, error: 'Please enter an amount greater than zero.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('payments').insert({
    registration_id: registrationId,
    amount_cents: amt,
    method,
    status: 'succeeded',
    received_on: receivedOn || new Date().toISOString().slice(0, 10),
    recorded_by: staff.userId,
    note: note?.trim() ? note.trim() : null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/payments');
  revalidatePath('/admin');
  return { ok: true };
}
