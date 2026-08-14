'use client';

// Admin control to reset a locked-out user's two-factor. It calls the
// admin-reset-mfa Edge Function, which re-checks that the caller is an admin
// server-side -- this form is a convenience, not the security boundary.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AdminMfaReset() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke('admin-reset-mfa', {
      body: { email: email.trim() },
    });
    setBusy(false);

    if (error) {
      // functions.invoke wraps a non-2xx as an error; try to surface the body.
      let message = 'Could not reset two-factor. Please try again.';
      try {
        const body = await error.context?.json?.();
        if (body?.error) message = body.error;
      } catch {
        /* fall back to the generic message */
      }
      setResult({ ok: false, message });
      return;
    }

    if (data?.ok) {
      setResult({
        ok: true,
        message:
          data.removed > 0
            ? `Done — removed ${data.removed} two-factor ${
                data.removed === 1 ? 'device' : 'devices'
              } from ${data.email}. They can log in with just their password and set it up again.`
            : `${data.email} had no two-factor set up, so there was nothing to remove.`,
      });
      setEmail('');
    } else {
      setResult({ ok: false, message: data?.error || 'Could not reset two-factor.' });
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Reset a user&rsquo;s two-factor</h2>
      <p className="text-sm text-neutral-500 mb-5 max-w-prose">
        For someone locked out because they lost their phone or reinstalled their
        authenticator app. This removes their two-factor so they can log in with
        their password and set it up again. It does not change their password.
      </p>

      <form onSubmit={submit} className="max-w-md">
        <label className="block font-semibold mb-1.5" htmlFor="reset-email">
          Their account email
        </label>
        <input
          id="reset-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@luke14ministries.net"
          className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-4"
        />
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Resetting…' : 'Reset two-factor'}
        </button>
      </form>

      {result && (
        <p
          className={`mt-5 rounded border px-4 py-3 ${
            result.ok
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
