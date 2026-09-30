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
//   can_view_giving    -> donor giving records (a separate grant for EVERYONE,
//                         admins included -- like sensitive, it is protection
//                         for the room, not a barrier against the person).
//                         Camp payments do NOT imply giving.
// These checks MIRROR the database's row-level security; RLS is the real
// backstop, so a page that forgets a check still cannot read data it shouldn't.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProgramLeadership } from '@/lib/programs';

export async function getStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('staff')
    .select('role, can_view_sensitive, can_view_giving, can_view_background_checks, title, active')
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
      // Deliberately NOT r === 'admin': giving is an explicit grant even for
      // administrators (mirrored in can_manage_giving(), migration 0025).
      return staff.can_view_giving === true;
    case 'background_checks':
      // Its own grant, like giving, and for the same reason: whether somebody
      // was screened and what came back is a different kind of knowledge from
      // their medical needs, and the people who need each are not the same set.
      // Administrators were granted it by 0058 so the permission could be
      // handed out at all; everyone else is explicit.
      return staff.can_view_background_checks === true;
    case 'door': // day-of check-in duty
      return r === 'registrar' || r === 'coordinator' || r === 'admin';
    default:
      return false;
  }
}

// WHERE A NON-STAFF VISITOR TO A STAFF PAGE GOES.
//
// Every /admin page starts with `if (!staff) redirect(...)`. Until 29 Sep 2026
// the target was always `/account/?next=<this page>`, which is right for a
// family member who wandered in -- log in, come back. It was wrong for a
// PROGRAM LEADER: the layout admits leaders (migration 0061), the page then
// throws them to /account/, /account/ sees a signed-in person and sends them
// back to ?next=, and the browser gives up with ERR_TOO_MANY_REDIRECTS. Found
// by Testing Script 3 §6.2/§7.1: a leader who typed /admin got an error page
// instead of their own roster. No staff content leaked; it was a loop, not a
// hole. A leader now lands on My Program; everyone else still goes to log in.
export async function bounceNonStaff(nextPath) {
  const leaderships = await getProgramLeadership();
  if (leaderships.length > 0) redirect('/admin/my-program/');
  redirect(`/account/?next=${nextPath}`);
}
