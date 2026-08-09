'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);

    const supabase = createClient();
    // One destination for everyone. Camper, volunteer, parent, sibling —
    // those are ROLES, and a role belongs to a person at one event, not to
    // an account. Asking at sign-up implied the account had a type, which
    // is the assumption that makes people create a second login later.
    const nextPath = '/account/dashboard/';

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        // Where the link in the confirmation email lands. It has to be an
        // absolute URL, and it has to match one of the entries in Supabase
        // under Authentication -> URL Configuration -> Redirect URLs, or
        // Supabase will refuse it and send the family to the site root with
        // no explanation.
        emailRedirectTo: `${window.location.origin}/auth/callback/?next=${encodeURIComponent(
          nextPath
        )}`,
        // These land in auth.users.raw_user_meta_data, which is where the
        // handle_new_user() trigger reads them from to create the row in
        // public.profiles. Rename a key here and the matching name in
        // supabase/migrations/0001_core_schema.sql has to change with it --
        // nothing will error, the profile will just come out blank.
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

    // Two possible outcomes, and which one happens depends on a Supabase
    // project setting (Authentication -> Providers -> Email -> Confirm email):
    //
    //   confirmation ON  -- no session yet. They must click the emailed link
    //                       first. data.session is null.
    //   confirmation OFF -- signed in immediately. data.session is present.
    //
    // Confirmation stays ON for this ministry: it is what stops someone
    // registering a family under an address they do not own.
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
