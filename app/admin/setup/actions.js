'use server';

// Setup-page actions. Admin-checked here AND by the events_write RLS policy
// (is_admin for ALL commands) -- the same belt-and-braces pattern as the rest
// of the admin area.

import { revalidatePath } from 'next/cache';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

export async function updateEventRegistration(eventId, { published, opensAt, closesAt }) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (!eventId) return { ok: false, error: 'Missing event.' };
  if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) {
    return { ok: false, error: 'Registration would close before it opens — check the two times.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('events')
    .update({
      published: Boolean(published),
      registration_opens_at: opensAt || null,
      registration_closes_at: closesAt || null,
    })
    .eq('id', eventId);

  if (error) {
    console.error('updateEventRegistration:', error.message);
    return { ok: false, error: 'Could not save. Please try again.' };
  }

  // Every public surface that lists open events re-renders with the change.
  revalidatePath('/admin/setup');
  revalidatePath('/register');
  revalidatePath('/register/family');
  return { ok: true };
}

// The facts of the event itself: when it runs, how many can come, what it
// costs. All three were readable on this page and editable only by me, which
// is not a workable arrangement for a ministry that has to change a date
// (asked for 25 Aug). Registration windows already lived here; these are the
// numbers underneath them.
//
// The FEE is not on the event: it lives on the published event_option, which
// is what registration_participants copies and what every balance is built
// from. Changing it here changes what the NEXT registration is charged and
// leaves every existing participant's fee exactly where it was -- which is
// the honest behaviour. Re-pricing someone who has already registered is a
// per-person decision with a paper trail, and that is the adjustments editor.
export async function updateEventDetails(
  eventId,
  { startsOn, endsOn, capacity, feeDollars, earlyEndsOn, earlyDollars }
) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (!eventId) return { ok: false, error: 'Missing event.' };

  if (!startsOn || !endsOn) return { ok: false, error: 'An event needs a start and an end date.' };
  if (endsOn < startsOn) {
    return { ok: false, error: 'The end date is before the start date — check the two.' };
  }

  let cap = null;
  if (String(capacity ?? '').trim() !== '') {
    cap = Number.parseInt(String(capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(cap) || cap < 0) {
      return { ok: false, error: 'Capacity has to be a whole number, or blank for no limit.' };
    }
  }

  const supabase = await createClient();

  // Refuse to set a capacity BELOW the people already registered. The number
  // would be immediately false, and the roster is the thing that is true.
  if (cap != null) {
    const { count } = await supabase
      .from('registration_participants')
      .select('id, registrations!inner ( event_id )', { count: 'exact', head: true })
      .eq('registrations.event_id', eventId)
      .neq('status', 'cancelled');
    if ((count ?? 0) > cap) {
      return {
        ok: false,
        error: `${count} people are already registered for this event, so the capacity cannot be set to ${cap}. Cancel places first, or set a higher number.`,
      };
    }
  }

  // Early registration (0080): a last day and a per-person amount. Blank
  // amount = no early discount. The date must fall before the event starts.
  let earlyCents = 0;
  if (String(earlyDollars ?? '').trim() !== '') {
    const n = Number.parseFloat(String(earlyDollars).replace(/[$,\s]/g, ''));
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, error: 'The early-registration discount has to be a dollar amount, or blank.' };
    }
    earlyCents = Math.round(n * 100);
  }
  if (earlyCents > 0 && !earlyEndsOn) {
    return { ok: false, error: 'Give the early-registration discount a last day, or clear the amount.' };
  }
  if (earlyEndsOn && earlyEndsOn >= startsOn) {
    return { ok: false, error: 'Early registration has to end before the event starts.' };
  }

  const { error } = await supabase
    .from('events')
    .update({
      starts_on: startsOn,
      ends_on: endsOn,
      capacity: cap,
      early_registration_ends_on: earlyEndsOn || null,
      early_registration_discount_cents: earlyCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId);
  if (error) {
    console.error('updateEventDetails:', error.message);
    return { ok: false, error: 'Could not save the event. Please try again.' };
  }

  if (String(feeDollars ?? '').trim() !== '') {
    const n = Number.parseFloat(String(feeDollars).replace(/[$,\s]/g, ''));
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, error: 'The dates and capacity saved, but the price is not a number.' };
    }
    const cents = Math.round(n * 100);
    const { data: opt } = await supabase
      .from('event_options')
      .select('id')
      .eq('event_id', eventId)
      .eq('published', true)
      // The ENROLLMENT option only. Without this, "the first published option"
      // could be 0069's zero-fee volunteer row, and saving a price here would
      // quietly charge volunteers and leave the camp fee unchanged.
      .is('participant_role', null)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    if (!opt) {
      return {
        ok: false,
        error: 'The dates and capacity saved, but this event has no published price to change.',
      };
    }
    const { error: feeError } = await supabase
      .from('event_options')
      .update({ fee_cents: cents, updated_at: new Date().toISOString() })
      .eq('id', opt.id);
    if (feeError) {
      return { ok: false, error: `The dates saved, but the price did not: ${feeError.message}` };
    }
  }

  revalidatePath('/admin/setup');
  revalidatePath('/register');
  revalidatePath('/register/family');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

// Create an event (2 Oct 2026). Until now every event was a migration, so a
// new camp week needed a developer. The work is one database function,
// admin_create_event (0083), so the event, its two price options, its
// agreements and -- when copying -- its activities and rooms all land in one
// transaction or not at all. A half-made event (no price, no agreements) would
// take registrations that sign nothing, which is worse than no event.
//
// Always created HIDDEN. Ticking "Visible" stays a separate, deliberate act.
const parseDollars = (v) => {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number.parseFloat(t);
  return Number.isNaN(n) || n < 0 ? Number.NaN : Math.round(n * 100);
};

export async function createEvent({
  name,
  eventType,
  startsOn,
  endsOn,
  feeDollars,
  depositDollars,
  capacity,
  location,
  copyFrom,
}) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };

  const cleanName = String(name ?? '').trim();
  if (!cleanName) return { ok: false, error: 'Give the event a name.' };
  if (!['camp_week', 'retreat'].includes(eventType)) {
    return { ok: false, error: 'Choose Camp or Retreat.' };
  }
  if (!startsOn || !endsOn) return { ok: false, error: 'An event needs a first and a last day.' };
  if (endsOn < startsOn) {
    return { ok: false, error: 'The last day is before the first day — check the two.' };
  }

  const fee = parseDollars(feeDollars);
  if (fee == null || Number.isNaN(fee)) {
    return { ok: false, error: 'The price has to be a dollar amount (0 is allowed).' };
  }
  const deposit = parseDollars(depositDollars);
  if (Number.isNaN(deposit)) return { ok: false, error: 'The deposit has to be a dollar amount, or blank.' };
  if ((deposit ?? 0) > fee) return { ok: false, error: 'The deposit cannot be more than the price.' };

  let cap = null;
  if (String(capacity ?? '').trim() !== '') {
    cap = Number.parseInt(String(capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(cap) || cap < 0) {
      return { ok: false, error: 'Places has to be a whole number, or blank for no limit.' };
    }
  }

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc('admin_create_event', {
    p_name: cleanName,
    p_event_type: eventType,
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_fee_cents: fee,
    p_deposit_cents: deposit ?? 0,
    p_capacity: cap,
    p_location: String(location ?? '').trim() || null,
    p_copy_from: copyFrom || null,
  });
  if (error) {
    console.error('createEvent:', error.message);
    return { ok: false, error: `Could not create the event: ${error.message}` };
  }

  revalidatePath('/admin/setup');
  revalidatePath('/admin', 'layout');
  return { ok: true, id };
}
