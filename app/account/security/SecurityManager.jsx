'use client';

// Self-service two-factor (TOTP) management for the signed-in account.
//
// Two-factor here is an authenticator app (Google Authenticator, Authy, 1Password,
// the Microsoft one, etc.) generating a 6-digit code. Supabase does the crypto;
// this component walks the person through enroll -> scan -> confirm, lets them
// name each device, rename it later, remove it, and add more than one. Optional
// for families, required for staff (enforced in app/admin/layout.jsx).
//
// Device nicknames: GoTrue stores a friendly_name at enrolment but has no
// self-service rename, so the editable label lives in public.mfa_factor_labels
// (migration 0004), keyed by the factor id and scoped to the owner by RLS.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SecurityManager({ required }) {
  const router = useRouter();
  const supabase = createClient();

  const [factors, setFactors] = useState([]);
  const [trustedCount, setTrustedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Naming a new device, then enrolling it.
  const [adding, setAdding] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [enrolling, setEnrolling] = useState(null); // { factorId, qr, secret, uri, name }
  const [code, setCode] = useState('');

  // Renaming an existing device.
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const loadFactors = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(listError.message);
      setFactors([]);
      setLoading(false);
      return;
    }
    const verified = (data?.totp ?? []).filter((f) => f.status === 'verified');
    // Attach our editable nickname, falling back to GoTrue's friendly_name.
    const { data: labels } = await supabase
      .from('mfa_factor_labels')
      .select('factor_id, label');
    const byId = new Map((labels ?? []).map((l) => [l.factor_id, l.label]));
    setFactors(
      verified.map((f) => ({
        ...f,
        label: byId.get(f.id) || f.friendly_name || 'Authenticator app',
      }))
    );
    // Browsers remembered via "skip the code for 30 days" (RLS: own rows only).
    const { count } = await supabase
      .from('mfa_trusted_devices')
      .select('id', { count: 'exact', head: true })
      .gt('expires_at', new Date().toISOString());
    setTrustedCount(count ?? 0);
    setLoading(false);
  }, [supabase]);

  async function forgetTrustedBrowsers() {
    if (
      !confirm(
        'Forget all trusted browsers? Your 6-digit code will be required again at the next login on every device. (Your password and authenticator app are unaffected.)'
      )
    )
      return;
    setBusy(true);
    const { error: delError } = await supabase
      .from('mfa_trusted_devices')
      .delete()
      .neq('token_hash', '');
    setBusy(false);
    if (delError) {
      setError(delError.message);
      return;
    }
    try {
      localStorage.removeItem('l14_mfa_trust');
    } catch {
      /* fine */
    }
    setTrustedCount(0);
  }

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  function startAdd() {
    setError('');
    // A friendly default only for the very first device.
    setDeviceName(factors.length === 0 ? 'My phone' : '');
    setAdding(true);
  }

  async function beginEnroll(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const name = deviceName.trim() || 'Authenticator app';

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
      friendlyName: name,
    });
    setBusy(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }
    setAdding(false);
    setEnrolling({
      factorId: data.id,
      qr: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
      name,
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
    if (vError) {
      setBusy(false);
      setError('That code did not match. It changes every 30 seconds — try the current one.');
      return;
    }
    // Save the nickname now that the factor is real.
    await supabase
      .from('mfa_factor_labels')
      .upsert({ factor_id: enrolling.factorId, label: enrolling.name }, { onConflict: 'factor_id' });
    setBusy(false);
    setEnrolling(null);
    setCode('');
    await loadFactors();
    router.refresh(); // verifying steps the session up to AAL2
  }

  async function cancelEnroll() {
    if (enrolling) {
      await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId });
    }
    setEnrolling(null);
    setCode('');
    setError('');
  }

  function startRename(factor) {
    setError('');
    setEditingId(factor.id);
    setEditName(factor.label);
  }

  async function saveRename() {
    const name = editName.trim();
    if (!name) {
      setError('Please enter a name for this device.');
      return;
    }
    setBusy(true);
    const { error: upError } = await supabase
      .from('mfa_factor_labels')
      .upsert({ factor_id: editingId, label: name }, { onConflict: 'factor_id' });
    setBusy(false);
    if (upError) {
      setError(upError.message);
      return;
    }
    setEditingId(null);
    setEditName('');
    await loadFactors();
  }

  async function remove(factorId) {
    if (!confirm('Turn off two-factor for this device? You can turn it back on at any time.')) {
      return;
    }
    setBusy(true);
    const { error: unError } = await supabase.auth.mfa.unenroll({ factorId });
    if (!unError) {
      await supabase.from('mfa_factor_labels').delete().eq('factor_id', factorId);
    }
    setBusy(false);
    if (unError) {
      setError(unError.message);
      return;
    }
    await loadFactors();
    router.refresh();
  }

  const inputCls = 'w-full rounded border border-neutral-300 px-4 py-2.5';
  const isSvgMarkup = enrolling?.qr && enrolling.qr.trim().startsWith('<svg');

  return (
    <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8">
      <h2 className="text-2xl font-bold mb-1">Two-factor authentication</h2>
      <p className="text-sm text-neutral-500 mb-5">
        A second step at login — a 6-digit code from an app on your phone — so a
        stolen password alone can&rsquo;t get into your account.
      </p>

      {required && factors.length === 0 && !enrolling && !adding && (
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
          <p className="mb-3 text-neutral-700">
            Setting up <strong>{enrolling.name}</strong>.
          </p>
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
            className={`${inputCls} mb-5 tracking-widest`}
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
      ) : adding ? (
        <form onSubmit={beginEnroll}>
          <label className="block font-semibold mb-1.5" htmlFor="device-name">
            Name this device
          </label>
          <p className="text-sm text-neutral-500 mb-2">
            So you can tell your authenticators apart later — for example
            &ldquo;My phone&rdquo; or &ldquo;Work laptop (1Password).&rdquo;
          </p>
          <input
            id="device-name"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className={`${inputCls} mb-5`}
            placeholder="My phone"
            autoFocus
          />
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Starting…' : 'Continue'}
            </button>
            <button type="button" onClick={() => setAdding(false)} disabled={busy} className="btn-outline">
              Cancel
            </button>
          </div>
        </form>
      ) : factors.length > 0 ? (
        <div>
          <div className="mb-4 rounded border border-green-300 bg-green-50 px-4 py-3 text-green-800">
            <p className="font-semibold">
              Two-factor is <span className="font-bold uppercase tracking-wide">on</span>.
            </p>
            <p className="text-sm mt-0.5">
              You&rsquo;ll enter a code from your app each time you log in.
            </p>
          </div>
          <ul className="divide-y divide-neutral-100 mb-4">
            {factors.map((f) => (
              <li key={f.id} className="py-3">
                {editingId === f.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 min-w-[10rem] rounded border border-neutral-300 px-3 py-1.5 text-sm"
                      autoFocus
                    />
                    <button onClick={saveRename} disabled={busy} className="btn-primary !py-1.5 text-sm">
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                      className="btn-outline !py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="font-medium">{f.label}</span>
                      <span className="text-neutral-400 text-sm"> · authenticator app</span>
                    </span>
                    <span className="flex gap-3 shrink-0 text-sm">
                      <button onClick={() => startRename(f)} className="text-brand underline">
                        Rename
                      </button>
                      <button onClick={() => remove(f.id)} disabled={busy} className="text-red-700 underline">
                        Remove
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button onClick={startAdd} disabled={busy} className="btn-outline">
            Add another device
          </button>

          <div className="mt-6 border-t border-neutral-100 pt-4">
            <p className="text-sm font-semibold mb-1">Trusted browsers</p>
            <p className="text-sm text-neutral-500 mb-2">
              {trustedCount > 0
                ? `${trustedCount} ${trustedCount === 1 ? 'browser is' : 'browsers are'} remembered — the code is skipped there for 30 days (password still required).`
                : 'None right now. Ticking “Remember this browser” at login skips the code there for 30 days.'}
            </p>
            {trustedCount > 0 && (
              <button
                onClick={forgetTrustedBrowsers}
                disabled={busy}
                className="text-red-700 underline text-sm"
              >
                Forget all trusted browsers
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <p className="text-neutral-600 mb-4">
            Two-factor is currently <strong>off</strong> for this account.
          </p>
          <button onClick={startAdd} disabled={busy} className="btn-primary">
            Set up two-factor
          </button>
        </div>
      )}
    </div>
  );
}
