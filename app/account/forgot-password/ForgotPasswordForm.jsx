'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Turnstile, { turnstileEnabled } from '@/components/Turnstile';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaBump, setCaptchaBump] = useState(0);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (turnstileEnabled && !captchaToken) {
      setError('Please complete the "I am human" check just above the button.');
      return;
    }

    setBusy(true);

    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback/?next=/account/reset-password/`,
      // Verified by Supabase. This form is the most attractive of the three to
      // abuse -- it sends mail to an address the sender chooses -- so it is
      // the one where the check earns its keep most clearly.
      ...(captchaToken ? { captchaToken } : {}),
    });
    // The token is spent either way; the next attempt needs a fresh one.
    setCaptchaBump((n) => n + 1);

    // The result is deliberately ignored. Whether or not that address has an
    // account, the answer shown is the same -- otherwise this page becomes a
    // way of checking which families are registered with the ministry.
    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8">
        <h2 className="text-2xl font-bold mb-3">Check your email</h2>
        <p className="text-neutral-700">
          If there is an account for <strong className="break-words">{email}</strong>,
          a link to set a new password is on its way. It works once and expires
          after an hour.
        </p>
        <p className="mt-4 text-neutral-600 text-sm">
          No email after a few minutes? Check your spam folder, and make sure
          the address above is the one you signed up with.
        </p>
        <Link href="/account" className="btn-outline !py-2 mt-6 inline-block">
          Back to Log In
        </Link>
      </div>
    );
  }

  return (
    <form
      className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8"
      onSubmit={handleSubmit}
    >
      <h2 className="text-2xl font-bold mb-1">Reset your password</h2>
      <p className="text-sm text-neutral-500 mb-5">
        Enter the email address you signed up with and we&rsquo;ll send you a
        link to set a new password.
      </p>
      <label className="block font-semibold mb-1.5" htmlFor="fp-email">
        Email
      </label>
      <input
        id="fp-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-4"
      />

      {error && (
        <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <Turnstile
        onToken={setCaptchaToken}
        resetKey={captchaBump}
        className="mb-5 flex justify-center"
      />

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Sending…' : 'Send Reset Link'}
      </button>
      <p className="mt-5 text-center text-neutral-600 text-sm">
        <Link href="/account" className="text-brand underline">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
