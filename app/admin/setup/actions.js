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
