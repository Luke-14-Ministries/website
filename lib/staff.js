// Who, on staff, is the current viewer? Server-only.
//
// Reads the caller's own row from public.staff. The staff_select policy in
// 0001_core_schema.sql lets a signed-in user read their own staff row, so this
// needs no elevated access. Returns null for anyone who is not active staff.
//
// Access model (from the staff table + helper functions in 0001/0010):
//   registrar   -> registrations, payments, rosters
//   coordinator -> buddy assignments, activities
//   admin       -> everything, including granting roles
//   can_view_sensitive -> support needs, medical, camper ID photos (a separate
//                         grant, not implied by role)
//   can_view_giving    -> donor giving records (a separate grant; admins have
//                         it implicitly). Camp payments do NOT imply giving.
// These checks MIRROR the database's row-level security; RLS is the real
// backstop, so a page that forgets a check still cannot read data it shouldn't.

import { createClient } from '@/lib/supabase/server';

export async function getStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('staff')
    .select('role, can_view_sensitive, can_view_giving, title, active')
    .eq('profile_id', user.id)
    .maybeSingle();

  if (!data || !data.active) return null;
  return { ...data, userId: user.id, email: user.email };
}

export function can(staff, need) {
  if (!staff) return false;
  const r = staff.role;
  switch (need) {
    case 'staff':
      return true;
    case 'registrar':
      return r === 'registrar' || r === 'admin';
    case 'coordinator':
      return r === 'coordinator' || r === 'admin';
    case 'admin':
      return r === 'admin';
    case 'sensitive':
      return staff.can_view_sensitive === true;
    case 'giving':
      return r === 'admin' || staff.can_view_giving === true;
    case 'door': // day-of check-in duty
      return r === 'registrar' || r === 'coordinator' || r === 'admin';
    default:
      return false;
  }
}
