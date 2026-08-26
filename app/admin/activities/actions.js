'use server';

// Activities, edited by the people who run them.
//
// Until now every activity in the ministry was seeded by migration. Adding
// one, correcting a capacity, or taking one off an event meant asking the web
// admin — which testing (25 Aug) named for what it is: not sensible. Camp
// changes what it offers between weeks, sometimes between years, and nobody
// should have to file a request to say so.
//
// Writes are gated by is_coordinator() in RLS (0039). The checks here are the
// friendly half; Postgres is the boundary.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

const MODES = ['interest', 'signup'];

async function requireCoordinator() {
  const staff = await getStaff();
  if (!can(staff, 'coordinator')) {
    return { error: 'You do not have permission to change activities.' };
  }
  return { staff };
}

// Shared shaping so create and update cannot drift apart.
function shape(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) return { error: 'An activity needs a name.' };

  const mode = MODES.includes(input?.mode) ? input.mode : 'interest';

  let capacity = null;
  if (String(input?.capacity ?? '').trim() !== '') {
    const n = Number.parseInt(String(input.capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(n) || n < 0) {
      return { error: 'Places has to be a whole number, or blank for no limit.' };
    }
    capacity = n;
  }
  // "Interest" means we are asking who fancies it, not holding places. A
  // capacity on an interest activity would be counted against nothing and
  // shown to nobody, so it is dropped rather than quietly stored.
  if (mode === 'interest') capacity = null;

  const provider = String(input?.providerName ?? '').trim();
  const url = String(input?.providerUrl ?? '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return { error: 'The provider link needs to start with http:// or https://' };
  }

  return {
    row: {
      name,
      description: String(input?.description ?? '').trim() || null,
      booking_mode: mode,
      capacity,
      // A provider name is what makes the site tell families the outfitter has
      // their own form. Blank means the ministry runs it.
      provider_name: provider || null,
      provider_url: url || null,
      active: input?.active !== false,
      sort_order: Number.parseInt(String(input?.sortOrder ?? '').trim(), 10) || 0,
    },
  };
}

export async function createActivity(eventId, input) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!eventId) return { ok: false, error: 'Which event?' };

  const { row, error } = shape(input);
  if (error) return { ok: false, error };

  const supabase = await createClient();
  const { error: dbError } = await supabase
    .from('activities')
    .insert({ event_id: eventId, ...row });
  if (dbError) {
    console.error('createActivity:', dbError.message);
    return { ok: false, error: 'That could not be added.' };
  }

  revalidateAll();
  return { ok: true };
}

export async function updateActivity(activityId, input) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const { row, error } = shape(input);
  if (error) return { ok: false, error };

  const supabase = await createClient();

  // Refuse a capacity below the people already signed up, for the same reason
  // the event capacity refuses it: the number would be false the moment it
  // saved, and the list of names is the thing that is true.
  if (row.capacity != null) {
    const { count } = await supabase
      .from('activity_signups')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activityId)
      .neq('status', 'cancelled');
    if ((count ?? 0) > row.capacity) {
      return {
        ok: false,
        error: `${count} people are already signed up, so the number of places cannot be ${row.capacity}. Take names off first, or set a higher number.`,
      };
    }
  }

  const { error: dbError } = await supabase
    .from('activities')
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq('id', activityId);
  if (dbError) {
    console.error('updateActivity:', dbError.message);
    return { ok: false, error: 'That could not be saved.' };
  }

  revalidateAll();
  return { ok: true };
}

// Two different things, and the difference matters.
//
// TURNING IT OFF (active = false) hides it from families and keeps everything:
// who had signed up, when, and what they acknowledged. That is what you want
// for "not running this year".
//
// DELETING removes the row. Allowed only while nobody has signed up, because
// activity_signups cascades — deleting an activity with names on it would
// silently take a family's answer with it, and no screen would ever say so.
export async function setActivityActive(activityId, active) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };

  const supabase = await createClient();
  const { error } = await supabase
    .from('activities')
    .update({ active: Boolean(active), updated_at: new Date().toISOString() })
    .eq('id', activityId);
  if (error) return { ok: false, error: 'That could not be changed.' };

  revalidateAll();
  return { ok: true };
}

export async function deleteActivity(activityId) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const supabase = await createClient();
  const { count } = await supabase
    .from('activity_signups')
    .select('id', { count: 'exact', head: true })
    .eq('activity_id', activityId);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} ${
        count === 1 ? 'person has' : 'people have'
      } already put their name down for this. Turn it off instead — that hides it from families and keeps the record of who asked.`,
    };
  }

  const { error } = await supabase.from('activities').delete().eq('id', activityId);
  if (error) {
    console.error('deleteActivity:', error.message);
    return { ok: false, error: 'That could not be removed.' };
  }

  revalidateAll();
  return { ok: true };
}

function revalidateAll() {
  revalidatePath('/admin/activities');
  revalidatePath('/account/activities');
}
