'use server';

// Server actions for the Accounts page. Every one of these re-checks admin
// here AND relies on the database function's own is_admin() check -- the same
// belt-and-braces pattern as the rest of the admin area. If this file were
// deleted, nothing would open up; if the database checks were deleted, this
// file would still refuse. Both have to fail before anything leaks.

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getStaff, can } from '@/lib/staff';
import { createClient } from '@/lib/supabase/server';

// Remove a login only. The database cascades take the profile, staff row and
// MFA devices; the family's records survive untouched (see migration 0022 for
// the full accounting of what goes and what stays).
export async function removeLogins(userIds) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { ok: false, error: 'Nothing selected.' };
  }

  const supabase = await createClient();
  const failed = [];
  // One at a time, on purpose: a batch of fifty test accounts with one failure
  // in the middle should still remove the other forty-nine, and report which
  // one refused rather than a single unhelpful "something went wrong".
  for (const id of userIds) {
    const { error } = await supabase.rpc('admin_delete_login', { p_user_id: id });
    if (error) failed.push({ id, message: error.message });
  }

  revalidatePath('/admin/accounts');
  if (failed.length > 0) {
    return {
      ok: false,
      removed: userIds.length - failed.length,
      error:
        failed.length === 1
          ? failed[0].message
          : `${failed.length} of ${userIds.length} could not be removed. First error: ${failed[0].message}`,
    };
  }
  return { ok: true, removed: userIds.length };
}

// Delete a household and everything under it -- registrations, participants,
// payments, people, and the member logins. The one the confirmation dialog
// makes you type for. Gift records survive as anonymous rows by design.
export async function purgeHousehold(householdId) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!householdId) return { ok: false, error: 'Missing household.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_purge_household', {
    p_household_id: householdId,
  });

  if (error) {
    console.error('admin_purge_household:', error.message);
    return { ok: false, error: error.message };
  }
  revalidatePath('/admin/accounts');
  return { ok: true };
}

// Clear someone's two-factor so they can log in with just their password and
// set it up again. Same operation the Two-Factor Resets page performs, minus
// the typed email address -- the row already says who.
export async function resetMfa(userId) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!userId) return { ok: false, error: 'Missing account.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_reset_mfa', {
    p_user_id: userId,
  });

  if (error) {
    console.error('admin_reset_mfa:', error.message);
    return { ok: false, error: error.message };
  }
  revalidatePath('/admin/accounts');
  return { ok: true, removed: data ?? 0 };
}

// Re-send the confirmation email to an account that never confirmed. Uses the
// caller's origin for the redirect so it works identically on the preview URL
// and, later, the real domain. Supabase rate-limits this per address; the
// error message it returns ("can only request this after ...") is shown as-is
// because it says exactly what to do: wait.
export async function resendVerification(email) {
  const staff = await getStaff();
  if (!can(staff, 'admin')) return { ok: false, error: 'Not permitted.' };
  if (!email) return { ok: false, error: 'Missing email.' };

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host');

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: `${proto}://${host}/auth/callback/?next=%2Faccount%2Fdashboard%2F`,
    },
  });

  if (error) {
    console.error('resendVerification:', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
