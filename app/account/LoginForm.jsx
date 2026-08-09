'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Middleware puts ?next=/whatever on the URL when it turns an anonymous
  // visitor away from a signed-in page, so login can send them back there.
  const next = searchParams.get('next') || '/account/dashboard/';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Deliberately vague. Supabase distinguishes "no such account" from
      // "wrong password", and repeating that distinction back to the browser
      // turns this form into a way of finding out who has an account here.
      // With families and medical details behind it, that is not a trade worth
      // making for slightly friendlier wording.
      setError('That email and password did not match. Please try again.');
      setBusy(false);
      return;
    }

    // refresh() makes the server re-render with the new session cookie.
    // Without it the dashboard can render from a cached signed-out version.
    router.push(next);
    router.refresh();
  }

  return (
    <form
      className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8"
      onSubmit={handleSubmit}
    >
      <h2 className="text-2xl font-bold mb-1">Log In</h2>
      <p className="text-sm text-neutral-500 mb-5">
        Use the email address and password you set when you created your
        account.
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800"
        >
          {error}
        </p>
      )}

      <label className="block font-semibold mb-1.5" htmlFor="login-email">
        Email
      </label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-4"
      />
      <label className="block font-semibold mb-1.5" htmlFor="login-password">
        Password
      </label>
      <input
        id="login-password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-6"
      />
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Logging in…' : 'Log In'}
      </button>

      <div className="mt-5 text-center text-neutral-600">
        <p>
          New to Luke 14 Ministries?{' '}
          <Link href="/account/signup" className="text-brand underline">
            Create an account
          </Link>
        </p>
        <p className="mt-2 text-sm">
          <Link href="/account/forgot-password" className="text-brand underline">
            Forgot password?
          </Link>
        </p>
      </div>
    </form>
  );
}
