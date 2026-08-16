'use server';

// My Contact Info & Preferences. Everything here is the signed-in user's own
// record: profiles_update_self RLS allows only their row, and the login-email
// change goes through Supabase Auth's own confirmation flow.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function updateMyProfile(form) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in again.' };

  const { error } = await supabase
    .from('profiles')
    .update({
      first_name: clean(form.first_name),
      last_name: clean(form.last_name),
      phone: clean(form.phone),
      sms_opt_in: form.sms_opt_in === 'on' || form.sms_opt_in === true,
    })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/contact');
  revalidatePath('/account/dashboard');
  return { ok: true };
}

// Changing the LOGIN email is an auth operation: Supabase emails a
// confirmation link to the new address, and nothing changes until it is
// clicked. (With "secure email change" enabled, the old address gets one too.)
export async function requestLoginEmailChange(newEmail) {
  const email = String(newEmail ?? '').trim();
  if (!email || !email.includes('@')) return { ok: false, error: 'Enter a valid email address.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    message: `Confirmation sent to ${email}. Your login email changes once you click the link in that message.`,
  };
}

export async function setEmailNews(optIn) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Please log in again.' };

  const { error } = await supabase
    .from('profiles')
    .update({ email_news: !!optIn })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/contact');
  return { ok: true };
}
