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

  // Second-step (two-factor) state. `mfa` holds the factor + challenge once a
  // password login lands on an account that has two-factor turned on.
  const [mfa, setMfa] = useState(null); // { factorId, challengeId }
  const [code, setCode] = useState('');

  const router = useRouter();
  const searchParams = useSearchParams();

  // Middleware puts ?next=/whatever on the URL when it turns an anonymous
  // visitor away from a signed-in page, so login can send them back there.
  const next = searchParams.get('next') || '/account/dashboard/';

  // Set by the idle auto-logout when it signs someone out, so the login page can
  // explain why they landed back here.
  const timedOut = searchParams.get('timeout');

  const supabase = createClient();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Deliberately vague. Supabase distinguishes "no such account" from
      // "wrong password", and repeating that distinction back to the browser
      // turns this form into a way of finding out who has an account here.
      setError('That email and password did not match. Please try again.');
      setBusy(false);
      return;
    }

    // Does this account have two-factor turned on? getAuthenticatorAssuranceLevel
    // says so: nextLevel is 'aal2' only when a verified factor exists, and
    // currentLevel is still 'aal1' right after a password login. For every
    // account WITHOUT two-factor (which is all of them until someone enrols),
    // nextLevel is 'aal1' and this whole branch is skipped -- so adding this
    // changes nothing for them.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
      const { data: list } = await supabase.auth.mfa.listFactors();
      const factor = (list?.totp ?? []).find((f) => f.status === 'verified');
      if (factor) {
        const { data: ch, error: chError } = await supabase.auth.mfa.challenge({
          factorId: factor.id,
        });
        if (chError) {
          setError('Could not start the two-factor step. Please try logging in again.');
          setBusy(false);
          return;
        }
        setMfa({ factorId: factor.id, challengeId: ch.id });
        setCode('');
        setBusy(false);
        return; // Show the code step instead of finishing the login.
      }
    }

    finish();
  }

  async function handleVerify(e) {
    e.preventDefault();
    if (!mfa) return;
    setError('');
    setBusy(true);
    const { error: vError } = await supabase.auth.mfa.verify({
      factorId: mfa.factorId,
      challengeId: mfa.challengeId,
      code: code.trim(),
    });
    if (vError) {
      setError('That code did not match. It changes every 30 seconds — try the current one.');
      setBusy(false);
      return;
    }
    finish();
  }

  function finish() {
    // refresh() makes the server re-render with the new session cookie.
    router.push(next);
    router.refresh();
  }

  // --- the two-factor code step ---------------------------------------------
  if (mfa) {
    return (
      <form
        className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8"
        onSubmit={handleVerify}
      >
        <h2 className="text-2xl font-bold mb-1">Enter your code</h2>
        <p className="text-sm text-neutral-500 mb-5">
          Open your authenticator app and enter the current 6-digit code for
          Luke 14 Ministries.
        </p>

        {error && (
          <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800">
            {error}
          </p>
        )}

        <label className="block font-semibold mb-1.5" htmlFor="login-code">
          6-digit code
        </label>
        <input
          id="login-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-6 tracking-widest"
          placeholder="123456"
        />
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Verifying…' : 'Verify & Continue'}
        </button>
      </form>
    );
  }

  // --- the password step ----------------------------------------------------
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

      {timedOut && !error && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          You were signed out after a period of inactivity. Please log in again.
        </p>
      )}

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
