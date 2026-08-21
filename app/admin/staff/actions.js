'use server';

// Staff & Access management. Admin-only. The staff_write RLS policy
// (is_admin() for ALL commands) is the real gate; these checks give friendly
// errors instead of silent failures. Adding staff uses the narrow
// staff_lookup_by_email RPC (migration 0011), because emails live in
// auth.users, which clients cannot read.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getStaff, can } from '@/lib/staff';

const ROLES = ['registrar', 'coordinator', 'admin'];

export async function updateStaffMember(profileId, patch) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (profileId === staff.userId && patch.role && patch.role !== 'admin') {
    return { ok: false, error: 'You cannot remove your own admin role. Ask another admin.' };
  }
  if (profileId === staff.userId && patch.active === false) {
    return { ok: false, error: 'You cannot deactivate yourself. Ask another admin.' };
  }

  const clean = {};
  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role)) return { ok: false, error: 'Unknown role.' };
    clean.role = patch.role;
  }
  if (patch.title !== undefined) clean.title = String(patch.title).trim() || null;
  if (patch.can_view_sensitive !== undefined) clean.can_view_sensitive = !!patch.can_view_sensitive;
  if (patch.can_view_giving !== undefined) clean.can_view_giving = !!patch.can_view_giving;
  if (patch.active !== undefined) clean.active = !!patch.active;

  const supabase = await createClient();
  const { error } = await supabase.from('staff').update(clean).eq('profile_id', profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/staff');
  return { ok: true };
}

export async function addStaffMember(email, role) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (!ROLES.includes(role)) return { ok: false, error: 'Unknown role.' };
  const cleanEmail = String(email ?? '').trim();
  if (!cleanEmail) return { ok: false, error: 'Enter an email address.' };

  const supabase = await createClient();
  const { data: found, error: lookupError } = await supabase.rpc('staff_lookup_by_email', {
    p_email: cleanEmail,
  });
  if (lookupError) return { ok: false, error: lookupError.message };
  if (!found || found.length === 0) {
    return {
      ok: false,
      error:
        'No account found with that email. They need to create an account on the site first — then add them here.',
    };
  }

  const person = found[0];
  const { error } = await supabase.from('staff').upsert(
    {
      profile_id: person.profile_id,
      role,
      active: true,
    },
    { onConflict: 'profile_id' }
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/staff');
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ') || cleanEmail;
  return { ok: true, name };
}

// Remove someone from the staff list entirely -- for a helper who has moved
// on, as opposed to Deactivate, which parks them for reactivation. Deletes
// ONLY the staff row: their account, family records, and anything they
// recorded as staff (notes, grants -- those reference profiles, not staff)
// are untouched, and they can be re-added later with "Add a staff member".
export async function removeStaffMember(profileId) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Admins only.' };
  if (profileId === staff.userId) {
    return { ok: false, error: 'You cannot remove yourself from staff. Ask another admin.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('staff').delete().eq('profile_id', profileId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/staff');
  return { ok: true };
}
