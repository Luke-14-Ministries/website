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

// ---------------------------------------------------------------------------
// Time slots (0052). The pontoon goes out four times on the Tuesday; the salon
// takes one person at a time. "Who is on the 2 o'clock boat" is the question
// the day is run from, and it had no home.
//
// Times are WALL-CLOCK AT CAMP -- a date and two times of day, stored as such.
// Nothing converts between zones, which is the point: a coordinator setting up
// from Mountain time is describing 2pm at camp, and a boarding time an hour out
// is discovered at the dock.

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function createSlot(activityId, input) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const date = String(input?.date ?? '').trim();
  const start = String(input?.start ?? '').trim();
  const end = String(input?.end ?? '').trim();
  if (!date) return { ok: false, error: 'Which day?' };
  if (!HHMM.test(start) || !HHMM.test(end)) {
    return { ok: false, error: 'Give a start and end time.' };
  }
  if (end <= start) return { ok: false, error: 'The end time is before the start time.' };

  let capacity = null;
  if (String(input?.capacity ?? '').trim() !== '') {
    const n = Number.parseInt(String(input.capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(n) || n < 1) {
      return { ok: false, error: 'Places has to be 1 or more, or blank for no limit.' };
    }
    capacity = n;
  }

  const supabase = await createClient();
  const { error } = await supabase.from('activity_slots').insert({
    activity_id: activityId,
    slot_date: date,
    start_time: start,
    end_time: end,
    label: String(input?.label ?? '').trim() || null,
    capacity,
  });
  if (error) {
    console.error('createSlot:', error.message);
    return { ok: false, error: 'That time could not be added.' };
  }

  revalidateAll();
  return { ok: true };
}

export async function deleteSlot(slotId) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!slotId) return { ok: false, error: 'Which time?' };

  const supabase = await createClient();

  // Refused while anyone is on it. Deleting would either orphan them onto the
  // activity with no time (which the 0052 guard forbids) or take their signup
  // with it -- and a family whose booking vanished is told by nothing.
  const { count } = await supabase
    .from('activity_signups')
    .select('id', { count: 'exact', head: true })
    .eq('slot_id', slotId)
    .neq('status', 'cancelled');

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `${count} ${
        count === 1 ? 'person is' : 'people are'
      } booked on this time. Move them to another time first — they cannot be left on the activity with no time.`,
    };
  }

  const { error } = await supabase.from('activity_slots').delete().eq('id', slotId);
  if (error) return { ok: false, error: 'That time could not be removed.' };

  revalidateAll();
  return { ok: true };
}

// Build a run of times in one go.
//
// The salon takes one person at a time from 9 to 5; the pontoon runs half-hour
// trips all Tuesday afternoon. Typing twenty of those by hand is how a
// coordinator decides the software is not worth it, and how the twelfth one
// ends up starting at 2:15 instead of 2:20 (asked for 25 Aug).
//
// Everything is checked BEFORE anything is written: a partial run is worse
// than none, because the gap is invisible until somebody cannot book.
export async function generateSlots(activityId, input) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!activityId) return { ok: false, error: 'Which activity?' };

  const date = String(input?.date ?? '').trim();
  const start = String(input?.start ?? '').trim();
  const end = String(input?.end ?? '').trim();
  if (!date) return { ok: false, error: 'Which day?' };
  if (!HHMM.test(start) || !HHMM.test(end)) {
    return { ok: false, error: 'Give a start and an end time for the whole run.' };
  }
  if (end <= start) return { ok: false, error: 'The run ends before it starts.' };

  const minutes = Number.parseInt(String(input?.minutes ?? '').trim(), 10);
  if (Number.isNaN(minutes) || minutes < 5) {
    return { ok: false, error: 'How long is each slot? Five minutes or more.' };
  }

  let capacity = null;
  if (String(input?.capacity ?? '').trim() !== '') {
    const n = Number.parseInt(String(input.capacity).replace(/[^0-9-]/g, ''), 10);
    if (Number.isNaN(n) || n < 1) {
      return { ok: false, error: 'Places per slot has to be 1 or more, or blank for no limit.' };
    }
    capacity = n;
  }

  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  const from = toMin(start);
  const to = toMin(end);
  const count = Math.floor((to - from) / minutes);
  if (count < 1) {
    return { ok: false, error: 'That run is shorter than one slot.' };
  }
  // A guard on the coordinator's own typo, not on the ministry: 5-minute slots
  // across a whole day is 200 rows, and nobody means that.
  if (count > 60) {
    return {
      ok: false,
      error: `That would make ${count} slots. If you really want that many, add them in a few runs — it is usually a typo in the length.`,
    };
  }

  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      activity_id: activityId,
      slot_date: date,
      start_time: toHHMM(from + i * minutes),
      end_time: toHHMM(from + (i + 1) * minutes),
      capacity,
      // Numbered so two slots at the same time on different boats can still be
      // told apart, and so the run reads as a run.
      label: String(input?.labelPrefix ?? '').trim()
        ? `${String(input.labelPrefix).trim()} ${i + 1}`
        : null,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from('activity_slots').insert(rows);
  if (error) {
    console.error('generateSlots:', error.message);
    return { ok: false, error: 'Those times could not be added.' };
  }

  revalidateAll();
  return { ok: true, made: rows.length };
}
