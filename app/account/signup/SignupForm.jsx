'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SignupForm() {
  const [form, setForm] = useState({
    first: '',
    last: '',
    email: '',
    phone: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Where to land after the account is confirmed. A guest sent here from
  // /register/family arrives with ?next=/register/family/, so we return them
  // to the form instead of dumping them on the dashboard. Only ever an internal
  // path -- never a full URL -- so this can't be turned into an open redirect.
  const rawNext = searchParams.get('next');
  const nextPath =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
      ? rawNext
      : '/account/dashboard/';

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);

    const supabase = createClient();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        // The link in the confirmation email lands here; ?next= is carried
        // through so the callback drops them back where they were headed. This
        // absolute URL must match a Redirect URL in Supabase (Authentication ->
        // URL Configuration) or Supabase silently sends them to the site root.
        emailRedirectTo: `${window.location.origin}/auth/callback/?next=${encodeURIComponent(
          nextPath
        )}`,
        // These land in auth.users.raw_user_meta_data, where the
        // handle_new_user() trigger reads them to create public.profiles. Rename
        // a key here and the matching name in 0001_core_schema.sql must change
        // with it -- nothing errors, the profile just comes out blank.
        data: {
          first_name: form.first,
          last_name: form.last,
          phone: form.phone,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setBusy(false);
      return;
    }

    // confirmation ON  -> no session yet; they must click the emailed link.
    // confirmation OFF -> signed in immediately. Confirmation stays ON here.
    if (data.session) {
      router.push(nextPath);
      router.refresh();
    } else {
      router.push(
        `/account/check-email/?email=${encodeURIComponent(form.email)}`
      );
    }
  }

  return (
    <form
      className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8"
      onSubmit={handleSubmit}
    >
      {error && (
        <p
          role="alert"
          className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800"
        >
          {error}
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block font-semibold mb-1.5" htmlFor="su-first">
            First name
          </label>
          <input id="su-first" autoComplete="given-name" required value={form.first} onChange={set('first')} className="w-full rounded border border-neutral-300 px-4 py-2.5" />
        </div>
        <div>
          <label className="block font-semibold mb-1.5" htmlFor="su-last">
            Last name
          </label>
          <input id="su-last" autoComplete="family-name" required value={form.last} onChange={set('last')} className="w-full rounded border border-neutral-300 px-4 py-2.5" />
        </div>
      </div>
      <label className="block font-semibold mb-1.5 mt-4" htmlFor="su-email">
        Email
      </label>
      <input id="su-email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} className="w-full rounded border border-neutral-300 px-4 py-2.5" />
      <label className="block font-semibold mb-1.5 mt-4" htmlFor="su-phone">
        Phone
      </label>
      <input id="su-phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} className="w-full rounded border border-neutral-300 px-4 py-2.5" />
      <label className="block font-semibold mb-1.5 mt-4" htmlFor="su-password">
        Password
      </label>
      <input id="su-password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} className="w-full rounded border border-neutral-300 px-4 py-2.5" />
      <p className="mt-1.5 text-sm text-neutral-500">
        At least 8 characters.
      </p>

      <button type="submit" className="btn-primary w-full mt-6" disabled={busy}>
        {busy ? 'Creating account…' : 'Create Account & Continue'}
      </button>
      <p className="mt-4 text-center text-neutral-600 text-sm">
        Already have an account?{' '}
        <Link href="/account" className="text-brand underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
