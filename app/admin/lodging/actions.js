'use server';

// Bed assignments, done by coordinators. RLS already restricts writes to
// is_coordinator(); these actions carry the rules that are judgement rather
// than permission.

import { revalidatePath } from 'next/cache';
import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

// Place one person. UNIQUE on registration_participant_id makes this an
// upsert: moving someone from Cabin 2 to Cabin 3 edits their row rather than
// leaving them in two beds at once.
export async function assignLodging({ participantId, lodgingId, note }) {
  if (!participantId || !lodgingId) {
    return { ok: false, error: 'Pick both a person and a place.' };
  }

  const user = await getCurrentUser();
  const supabase = await createClient();

  const { error } = await supabase.from('lodging_assignments').upsert(
    {
      lodging_id: lodgingId,
      registration_participant_id: participantId,
      note: note || null,
      assigned_by: user?.id ?? null,
    },
    { onConflict: 'registration_participant_id' }
  );

  if (error) {
    console.error('assignLodging:', error.message);
    return { ok: false, error: 'That could not be saved.' };
  }

  revalidatePath('/admin/lodging');
  revalidatePath('/admin/checkin');
  return { ok: true };
}

export async function unassignLodging({ participantId }) {
  if (!participantId) return { ok: false, error: 'Nothing to remove.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('lodging_assignments')
    .delete()
    .eq('registration_participant_id', participantId);

  if (error) {
    console.error('unassignLodging:', error.message);
    return { ok: false, error: 'That could not be removed.' };
  }

  revalidatePath('/admin/lodging');
  revalidatePath('/admin/checkin');
  return { ok: true };
}

// Same publication gate as buddies: the RLS policy on lodging_assignments
// reads lodging_published(event_id), so until this is set a family's query
// simply returns nothing.
export async function setLodgingPublication({ eventId, publish }) {
  if (!eventId) return { ok: false, error: 'No event.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('events')
    .update({ lodging_assignments_published_at: publish ? new Date().toISOString() : null })
    .eq('id', eventId);

  if (error) {
    console.error('setLodgingPublication:', error.message);
    return { ok: false, error: 'That could not be changed.' };
  }

  revalidatePath('/admin/lodging');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The rooms themselves (29 Sep 2026).
//
// Until 0076 every cabin and room was seeded by migration, and the board had
// no way to add, rename or retire one. Larry's real room list for Carson
// Springs made that untenable: the venue changes what it lets us use, and a
// coordinator should not have to ask the web admin to rename "Lodge 111".
// Same shape as buddies/actions.js -- RLS (`lodgings_write`, is_coordinator())
// is the boundary; each action ALSO checks can(staff, 'coordinator') so a
// refused write gets a sentence rather than an empty result.
// ---------------------------------------------------------------------------

const KINDS = ['building', 'room', 'cabin', 'lodge', 'tent', 'rv', 'offsite'];

async function requireCoordinator() {
  const staff = await getStaff();
  if (!can(staff, 'coordinator')) {
    return { error: 'You do not have permission to change rooms and cabins.' };
  }
  return { staff };
}

// A blank box means "not said", never zero -- a room with no capacity given
// shows "N placed" rather than "N of 0 -- over".
function optionalCount(value, label) {
  const s = String(value ?? '').trim();
  if (s === '') return { n: null };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) {
    return { error: `${label} has to be a whole number, or blank if it is not known.` };
  }
  return { n };
}

// One shaping for add and edit, so the two cannot drift apart.
function shapeLodging(input) {
  const name = String(input?.name ?? '').trim();
  if (!name) return { error: 'A room or building needs a name.' };
  if (!KINDS.includes(input?.kind)) return { error: 'Pick what kind of place this is.' };

  const cap = optionalCount(input?.capacity, 'Capacity');
  if (cap.error) return { error: cap.error };
  const staffCap = optionalCount(input?.staffCapacity, 'Staff capacity');
  if (staffCap.error) return { error: staffCap.error };

  return {
    row: {
      name,
      kind: input.kind,
      capacity: cap.n,
      staff_capacity: staffCap.n,
      beds: String(input?.beds ?? '').trim() || null,
      accessible: Boolean(input?.accessible),
      accessible_notes: String(input?.accessibleNotes ?? '').trim() || null,
      notes: String(input?.notes ?? '').trim() || null,
    },
  };
}

// New places go at the end of their level: max(sort_order) + 1 among the
// siblings. Sort order is never typed in by hand -- the venue list is in
// walking order and staff add the odd room, so "after the others" is right
// every time it has come up.
async function nextSortOrder(supabase, eventId, parentId) {
  let q = supabase
    .from('lodgings')
    .select('sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: false })
    .limit(1);
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data, error } = await q;
  if (error) {
    console.error('nextSortOrder:', error.message);
    return { error };
  }
  return { n: (data?.[0]?.sort_order ?? 0) + 1 };
}

// Add (no id) or edit (id) one place. One action rather than two because the
// form is one form; the only difference is whether a row exists yet.
//
// On an add, parent_id and sort_order are set here. On an edit they are left
// alone: moving a room between buildings or reordering the list is not
// something the editor offers, and an edit that silently re-parented a room
// would be the kind of surprise a volunteer cannot diagnose.
export async function upsertLodging({ id, eventId, parentId, sortOrder, ...input }) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };

  const { row, error } = shapeLodging(input);
  if (error) return { ok: false, error };

  const supabase = await createClient();

  if (id) {
    const { data, error: dbError } = await supabase
      .from('lodgings')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (dbError) {
      console.error('upsertLodging update:', dbError.message);
      return { ok: false, error: 'That could not be saved.' };
    }
    // No rows back means the policy refused -- Postgres does not call an
    // UPDATE that matches nothing a failure, so say it here.
    if (!data || data.length === 0) {
      return { ok: false, error: 'Nothing was saved — you may not have permission to change this.' };
    }
    revalidatePath('/admin/lodging');
    return { ok: true, id };
  }

  if (!eventId) return { ok: false, error: 'Which event?' };

  // A room's parent must be a place on the same event. Without this a typo in
  // the client could hang a room under another camp's lodge, and it would
  // appear on neither board.
  if (parentId) {
    const { data: parent, error: parentError } = await supabase
      .from('lodgings')
      .select('id, event_id, parent_id')
      .eq('id', parentId)
      .maybeSingle();
    if (parentError) {
      console.error('upsertLodging parent:', parentError.message);
      return { ok: false, error: 'That could not be checked.' };
    }
    if (!parent || parent.event_id !== eventId) {
      return { ok: false, error: 'That building is not on this event.' };
    }
    // Two levels is what the board draws and what the camp has: a building
    // holds rooms. Rooms inside rooms would render, but nobody asked for it
    // and the occupancy arithmetic gets harder to check by eye.
    if (parent.parent_id) {
      return { ok: false, error: 'Rooms go inside a building, not inside another room.' };
    }
  }

  let sort_order = Number.isInteger(sortOrder) ? sortOrder : null;
  if (sort_order == null) {
    const next = await nextSortOrder(supabase, eventId, parentId || null);
    if (next.error) return { ok: false, error: 'That could not be added.' };
    sort_order = next.n;
  }

  const { data, error: dbError } = await supabase
    .from('lodgings')
    .insert({ event_id: eventId, parent_id: parentId || null, sort_order, ...row })
    .select('id');
  if (dbError) {
    console.error('upsertLodging insert:', dbError.message);
    return { ok: false, error: 'That could not be added.' };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: 'Nothing was saved — you may not have permission to change this.' };
  }

  revalidatePath('/admin/lodging');
  return { ok: true, id: data[0].id };
}

// Every place on one event, so a walk of the tree does not need a query per
// node. Small: the biggest inventory is ~90 rows.
async function lodgingTree(supabase, eventId) {
  const { data, error } = await supabase
    .from('lodgings')
    .select('id, parent_id, name, active')
    .eq('event_id', eventId);
  if (error) {
    console.error('lodgingTree:', error.message);
    return { error };
  }
  const childrenOf = new Map();
  for (const l of data ?? []) {
    if (!l.parent_id) continue;
    if (!childrenOf.has(l.parent_id)) childrenOf.set(l.parent_id, []);
    childrenOf.get(l.parent_id).push(l);
  }
  const byId = new Map((data ?? []).map((l) => [l.id, l]));
  return { rows: data ?? [], childrenOf, byId };
}

function descendantIds(childrenOf, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const k of childrenOf.get(cur) ?? []) {
      out.push(k.id);
      stack.push(k.id);
    }
  }
  return out;
}

// Retiring and restoring share one path because they are inverses and the
// tree rule runs both ways: a building takes its rooms with it, and a room
// brings its building back (the board only nests rooms under a visible
// parent, so a room whose building is hidden would be drawn nowhere).
async function setActive(id, active) {
  const supabase = await createClient();
  const { data: target, error: targetError } = await supabase
    .from('lodgings')
    .select('id, event_id, parent_id, name')
    .eq('id', id)
    .maybeSingle();
  if (targetError) {
    console.error('setActive:', targetError.message);
    return { ok: false, error: 'That could not be checked.' };
  }
  if (!target) return { ok: false, error: 'That place no longer exists.' };

  const tree = await lodgingTree(supabase, target.event_id);
  if (tree.error) return { ok: false, error: 'That could not be checked.' };

  let ids;
  if (active) {
    ids = [id];
    let p = tree.byId.get(target.parent_id);
    while (p) {
      ids.push(p.id);
      p = tree.byId.get(p.parent_id);
    }
  } else {
    ids = [id, ...descendantIds(tree.childrenOf, id)];
    // Refuse while anyone is placed here or in a room inside. The
    // alternative -- hiding the room and leaving the people in it -- is
    // exactly how somebody ends up placed nowhere the board can see.
    const { count, error: countError } = await supabase
      .from('lodging_assignments')
      .select('id', { count: 'exact', head: true })
      .in('lodging_id', ids);
    if (countError) {
      console.error('setActive count:', countError.message);
      return { ok: false, error: 'That could not be checked.' };
    }
    if ((count ?? 0) > 0) {
      const where = ids.length > 1 ? `${target.name} or the rooms in it` : target.name;
      return {
        ok: false,
        error: `${count} ${count === 1 ? 'person is' : 'people are'} still placed in ${where}. Move them first, then retire it.`,
      };
    }
  }

  const { data, error } = await supabase
    .from('lodgings')
    .update({ active: Boolean(active), updated_at: new Date().toISOString() })
    .in('id', ids)
    .select('id');
  if (error) {
    console.error('setActive:', error.message);
    return { ok: false, error: 'That could not be changed.' };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: 'Nothing was saved — you may not have permission to change this.' };
  }

  revalidatePath('/admin/lodging');
  return { ok: true };
}

// RETIRING hides a place and keeps the row (0076 did the same to the old
// placeholders): a test assignment may still point at it, and nothing should
// vanish from a family's history because a coordinator tidied the list.
export async function retireLodging({ id }) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!id) return { ok: false, error: 'Which room?' };
  return setActive(id, false);
}

// The undo for a retire done by mistake -- and the way the 0076 placeholders
// could be brought back if the real list turns out to be wrong.
export async function restoreLodging({ id }) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!id) return { ok: false, error: 'Which room?' };
  return setActive(id, true);
}

// The same venue, next week (or next year): copy the whole inventory rather
// than type sixty rooms twice. Only ACTIVE places come across, with their
// nesting, in their order. Assignments never do -- those are decisions about
// people at one camp.
//
// Refuses if the target already has active places. Merging two inventories
// -- "Lodge" from here and "Lodge" from there -- is a question a human should
// look at, not something to guess at.
export async function copyLodgingsFrom({ fromEventId, toEventId }) {
  const { error: authError } = await requireCoordinator();
  if (authError) return { ok: false, error: authError };
  if (!fromEventId || !toEventId) return { ok: false, error: 'Pick an event to copy from.' };
  if (fromEventId === toEventId) return { ok: false, error: 'That is the same event.' };

  const supabase = await createClient();

  const { count: existing, error: existingError } = await supabase
    .from('lodgings')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', toEventId)
    .eq('active', true);
  if (existingError) {
    console.error('copyLodgingsFrom count:', existingError.message);
    return { ok: false, error: 'That could not be checked.' };
  }
  if ((existing ?? 0) > 0) {
    return {
      ok: false,
      error: `This event already has ${existing} active ${existing === 1 ? 'place' : 'places'}. Copying only works into an empty event — retire what is here first if you really mean to replace it.`,
    };
  }

  const { data: source, error: srcError } = await supabase
    .from('lodgings')
    .select(
      'id, parent_id, name, kind, capacity, staff_capacity, beds, accessible, accessible_notes, notes, sort_order'
    )
    .eq('event_id', fromEventId)
    .eq('active', true)
    .order('sort_order');
  if (srcError) {
    console.error('copyLodgingsFrom read:', srcError.message);
    return { ok: false, error: 'The other event could not be read.' };
  }
  if (!source || source.length === 0) {
    return { ok: false, error: 'That event has no active rooms or buildings to copy.' };
  }

  // Parents first, so each child can point at its new parent id. Each level
  // is one insert, and the rows come back in the order they went in; the name
  // check is there so a surprise in that order fails loudly rather than
  // wiring "Lodge 101" under "Pine".
  const newIdOf = new Map(); // old id -> new id
  let remaining = source.filter((l) => !l.parent_id || source.some((s) => s.id === l.parent_id));
  let copied = 0;
  while (remaining.length > 0) {
    const level = remaining.filter((l) => !l.parent_id || newIdOf.has(l.parent_id));
    if (level.length === 0) break; // orphans (parent inactive): not copied
    const { data: inserted, error: insError } = await supabase
      .from('lodgings')
      .insert(
        level.map((l) => ({
          event_id: toEventId,
          parent_id: l.parent_id ? newIdOf.get(l.parent_id) : null,
          name: l.name,
          kind: l.kind,
          capacity: l.capacity,
          staff_capacity: l.staff_capacity,
          beds: l.beds,
          accessible: l.accessible,
          accessible_notes: l.accessible_notes,
          notes: l.notes,
          sort_order: l.sort_order,
        }))
      )
      .select('id, name');
    if (insError || !inserted || inserted.length !== level.length) {
      console.error('copyLodgingsFrom insert:', insError?.message ?? 'row count mismatch');
      revalidatePath('/admin/lodging');
      return {
        ok: false,
        error: `Copying stopped part-way (${copied} copied). Check the list before trying again.`,
      };
    }
    for (let i = 0; i < level.length; i += 1) {
      if (inserted[i].name !== level[i].name) {
        revalidatePath('/admin/lodging');
        return {
          ok: false,
          error: `Copying stopped part-way (${copied} copied): the rows came back out of order. Check the list.`,
        };
      }
      newIdOf.set(level[i].id, inserted[i].id);
    }
    copied += level.length;
    remaining = remaining.filter((l) => !newIdOf.has(l.id));
  }

  revalidatePath('/admin/lodging');
  return { ok: true, copied };
}
