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
export async function updateEventDetails(eventId, { startsOn, endsOn, capacity, feeDollars }) {
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

  const { error } = await supabase
    .from('events')
    .update({
      starts_on: startsOn,
      ends_on: endsOn,
      capacity: cap,
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
