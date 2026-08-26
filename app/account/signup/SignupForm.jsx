'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Turnstile, { turnstileEnabled } from '@/components/Turnstile';
import { emailLooksValid, formatPhone } from '@/lib/format';

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
  // The bot check. `captchaBump` forces a fresh token after any failed
  // attempt -- Turnstile tokens are single use, so retrying with a spent one
  // fails for a reason that has nothing to do with what the person typed.
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaBump, setCaptchaBump] = useState(0);
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

  // Phone is the number camp rings when something happens at 2am, and this
  // form was the one place in the site not checking it at all -- type="tel"
  // only changes the on-screen keyboard, it validates nothing (26 Aug).
  //
  // A hint, not a block. The house rule in lib/format is tidy-never-mangle,
  // and a hard stop would refuse a foreign number or an extension that is
  // perfectly correct. Someone who has typed four digits and moved on has
  // almost certainly slipped, and saying so is enough.
  const phoneDigits = (form.phone || '').replace(/\D/g, '');
  const phoneLooksShort = phoneDigits.length > 0 && phoneDigits.length < 10;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // Caught before Supabase is asked, so the message names the field rather
    // than surfacing as a provider error the person cannot act on.
    if (!emailLooksValid(form.email)) {
      setError('That email address doesn’t look right — please check it.');
      return;
    }

    if (turnstileEnabled && !captchaToken) {
      setError('Please complete the "I am human" check just above the button.');
      return;
    }

    setBusy(true);

    const supabase = createClient();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        // Verified by SUPABASE, not by this site -- see components/Turnstile.
        ...(captchaToken ? { captchaToken } : {}),
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
      setCaptchaBump((n) => n + 1);
      return;
    }

    // Supabase does not error when the email is already registered -- that would
    // let someone probe which addresses have accounts. Instead it returns a user
    // whose identities array is empty. That is how we catch a duplicate sign-up
    // and point the person to logging in, rather than silently showing a "check
    // your email" screen for a confirmation link that will never arrive.
    if (
      data?.user &&
      Array.isArray(data.user.identities) &&
      data.user.identities.length === 0
    ) {
      setError(
        'An account already exists for this email. Please log in instead, or use “Forgot password” if you need to reset it.'
      );
      setBusy(false);
      setCaptchaBump((n) => n + 1);
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
      <input
        id="su-phone"
        type="tel"
        autoComplete="tel"
        value={form.phone}
        onChange={set('phone')}
        // On blur, never on keystrokes: reformatting under a moving cursor is
        // maddening. formatPhone hands back anything that is not a clean
        // 10-digit US number exactly as typed.
        onBlur={() => setForm((f) => ({ ...f, phone: formatPhone(f.phone) }))}
        aria-describedby={phoneLooksShort ? 'su-phone-hint' : undefined}
        className="w-full rounded border border-neutral-300 px-4 py-2.5"
      />
      {phoneLooksShort && (
        <p id="su-phone-hint" className="mt-1.5 text-sm text-amber-800">
          That looks short for a phone number — a US number has 10 digits. Leave
          it as it is if it&rsquo;s right.
        </p>
      )}
      <label className="block font-semibold mb-1.5 mt-4" htmlFor="su-password">
        Password
      </label>
      <input id="su-password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} className="w-full rounded border border-neutral-300 px-4 py-2.5" />
      <p className="mt-1.5 text-sm text-neutral-500">
        At least 8 characters.
      </p>

      <Turnstile
        onToken={setCaptchaToken}
        resetKey={captchaBump}
        className="mt-5 flex justify-center"
      />

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
