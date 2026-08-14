'use client';

// Self-service two-factor (TOTP) management for the signed-in account.
//
// Two-factor here is an authenticator app (Google Authenticator, Authy, 1Password,
// the Microsoft one, etc.) generating a 6-digit code. Supabase does the crypto;
// this component only walks the person through enroll -> scan -> confirm, and lets
// them remove a factor later. It is OPTIONAL for families and REQUIRED for staff --
// the staff requirement is enforced in app/admin/layout.jsx, not here.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SecurityManager({ required }) {
  const router = useRouter();
  const supabase = createClient();

  const [factors, setFactors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Enrollment-in-progress state.
  const [enrolling, setEnrolling] = useState(null); // { factorId, qr, secret, uri }
  const [code, setCode] = useState('');

  const loadFactors = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(listError.message);
      setFactors([]);
    } else {
      // Only verified factors count as "on". Unverified ones are abandoned
      // enrollments and are cleaned up when a new enrollment starts.
      setFactors((data?.totp ?? []).filter((f) => f.status === 'verified'));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  async function startEnroll() {
    setError('');
    setBusy(true);
    // Clear any half-finished enrollment first, or Supabase refuses a second
    // TOTP factor while an unverified one lingers.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) {
      if (f.factor_type === 'totp' && f.status === 'unverified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Authenticator app',
    });
    setBusy(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }
    setEnrolling({
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    });
    setCode('');
  }

  async function confirmEnroll(e) {
    e.preventDefault();
    if (!enrolling) return;
    setError('');
    setBusy(true);
    const { data: ch, error: chError } = await supabase.auth.mfa.challenge({
      factorId: enrolling.factorId,
    });
    if (chError) {
      setBusy(false);
      setError(chError.message);
      return;
    }
    const { error: vError } = await supabase.auth.mfa.verify({
      factorId: enrolling.factorId,
      challengeId: ch.id,
      code: code.trim(),
    });
    setBusy(false);
    if (vError) {
      setError('That code did not match. It changes every 30 seconds — try the current one.');
      return;
    }
    setEnrolling(null);
    setCode('');
    await loadFactors();
    // Verifying steps this session up to AAL2, which the staff area checks for.
    router.refresh();
  }

  async function cancelEnroll() {
    if (enrolling) {
      await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId });
    }
    setEnrolling(null);
    setCode('');
    setError('');
  }

  async function remove(factorId) {
    if (!confirm('Turn off two-factor for this account? You can turn it back on at any time.')) {
      return;
    }
    setBusy(true);
    const { error: unError } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (unError) {
      setError(unError.message);
      return;
    }
    await loadFactors();
    router.refresh();
  }

  const isSvgMarkup = enrolling?.qr && enrolling.qr.trim().startsWith('<svg');

  return (
    <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8">
      <h2 className="text-2xl font-bold mb-1">Two-factor authentication</h2>
      <p className="text-sm text-neutral-500 mb-5">
        A second step at login — a 6-digit code from an app on your phone — so a
        stolen password alone can&rsquo;t get into your account.
      </p>

      {required && factors.length === 0 && !enrolling && (
        <p className="mb-5 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <strong>Staff accounts must turn this on.</strong> Because staff can see
          other families&rsquo; information, two-factor is required before you can
          open the staff area. It takes about a minute to set up below.
        </p>
      )}

      {error && (
        <p role="alert" className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500">Checking your security settings…</p>
      ) : enrolling ? (
        <form onSubmit={confirmEnroll}>
          <ol className="list-decimal pl-5 space-y-3 text-neutral-700 mb-4">
            <li>
              Open your authenticator app (Google Authenticator, Authy, 1Password,
              Microsoft Authenticator — any of them work).
            </li>
            <li>Scan this QR code, or type in the key below it.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>

          <div className="flex flex-col items-center gap-3 rounded-lg bg-neutral-50 border border-neutral-200 p-5 mb-4">
            {isSvgMarkup ? (
              <div
                className="h-44 w-44 [&>svg]:h-full [&>svg]:w-full"
                // Supabase hands back the QR as trusted SVG markup it generated.
                dangerouslySetInnerHTML={{ __html: enrolling.qr }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={enrolling.qr} alt="Two-factor QR code" className="h-44 w-44" />
            )}
            <div className="text-center">
              <div className="text-xs text-neutral-500">Can&rsquo;t scan? Enter this key:</div>
              <code className="text-sm break-all">{enrolling.secret}</code>
            </div>
          </div>

          <label className="block font-semibold mb-1.5" htmlFor="mfa-code">
            6-digit code
          </label>
          <input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-5 tracking-widest"
            placeholder="123456"
          />
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Verifying…' : 'Turn on two-factor'}
            </button>
            <button type="button" onClick={cancelEnroll} disabled={busy} className="btn-outline">
              Cancel
            </button>
          </div>
        </form>
      ) : factors.length > 0 ? (
        <div>
          <div className="flex items-center gap-2 mb-4 rounded border border-green-300 bg-green-50 px-4 py-3 text-green-800">
            <span className="font-semibold">Two-factor is on.</span>
            <span className="text-sm">You&rsquo;ll enter a code from your app each time you log in.</span>
          </div>
          <ul className="divide-y divide-neutral-100 mb-4">
            {factors.map((f) => (
              <li key={f.id} className="flex items-center justify-between py-3">
                <span>
                  {f.friendly_name || 'Authenticator app'}
                  <span className="text-neutral-400 text-sm"> · added</span>
                </span>
                <button onClick={() => remove(f.id)} disabled={busy} className="text-red-700 underline text-sm">
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button onClick={startEnroll} disabled={busy} className="btn-outline">
            Add another device
          </button>
        </div>
      ) : (
        <div>
          <p className="text-neutral-600 mb-4">
            Two-factor is currently <strong>off</strong> for this account.
          </p>
          <button onClick={startEnroll} disabled={busy} className="btn-primary">
            {busy ? 'Starting…' : 'Set up two-factor'}
          </button>
        </div>
      )}
    </div>
  );
}
