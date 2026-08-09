'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }

    // The reset link already signed them in, so there is nothing further to
    // do -- send them into the account area.
    router.push('/account/dashboard/');
    router.refresh();
  }

  return (
    <form
      className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8"
      onSubmit={handleSubmit}
    >
      <h2 className="text-2xl font-bold mb-1">Set a new password</h2>
      <p className="text-sm text-neutral-500 mb-5">
        You&rsquo;re signed in from the link in your email. Choose a new
        password and you&rsquo;re done.
      </p>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800"
        >
          {error}
        </p>
      )}

      <label className="block font-semibold mb-1.5" htmlFor="rp-password">
        New password
      </label>
      <input
        id="rp-password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-4"
      />
      <label className="block font-semibold mb-1.5" htmlFor="rp-confirm">
        Confirm new password
      </label>
      <input
        id="rp-confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-6"
      />
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save New Password'}
      </button>
    </form>
  );
}
