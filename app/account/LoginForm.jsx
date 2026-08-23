'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// --- Trusted browser ("remember this browser for 30 days") -----------------
// The password is still required at every login; only the 6-digit code is
// skipped, and only on a browser that has already passed two-factor once.
// A random token stays in this browser; its SHA-256 hash sits in
// mfa_trusted_devices, whose insert policy requires an aal2 session -- so the
// skip cannot be faked by someone who only knows the password.
// The token lives in a COOKIE (not localStorage) because the middleware is
// what enforces the two-factor rule on protected pages, and middleware can
// read cookies but never a browser's localStorage. The old localStorage slot
// is still read as a fallback so browsers trusted before this change keep
// their skip at login; passing the code once more writes the cookie and
// brings them fully into the new scheme.
const TRUST_KEY = 'l14_mfa_trust';
const TRUST_DAYS = 30;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readTrustCookie() {
  const m = document.cookie.match(/(?:^|;\s*)l14_mfa_trust=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function writeTrustCookie(token, expires) {
  document.cookie =
    `l14_mfa_trust=${encodeURIComponent(token)}; path=/; expires=${expires.toUTCString()}; SameSite=Lax; Secure`;
}

function readTrustStore() {
  try {
    return JSON.parse(localStorage.getItem(TRUST_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeTrustStore(store) {
  try {
    localStorage.setItem(TRUST_KEY, JSON.stringify(store));
  } catch {
    /* private-browsing modes can refuse; the code step still works */
  }
}

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Second-step (two-factor) state. `mfa` holds the factor + challenge once a
  // password login lands on an account that has two-factor turned on.
  const [mfa, setMfa] = useState(null); // { factorId, challengeId }
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);

  const searchParams = useSearchParams();

  // Middleware puts ?next=/whatever on the URL when it turns an anonymous
  // visitor away from a signed-in page, so login can send them back there.
  //
  // SANITISED, because this value arrives in the query string and we redirect
  // to it after a successful login. Unchecked, /account/?next=https://evil.example
  // is a working phishing link: it shows the REAL Luke 14 login page, takes a
  // genuine login, then hands the visitor to somebody else's site, where a
  // convincing "session expired, please log in again" page collects the
  // password. Only a path on this site is allowed. The leading-// case matters
  // as much as the scheme, because //evil.example is a protocol-relative URL,
  // not a path. app/account/page.jsx already applies this rule to its own
  // redirect; this was the branch that missed it.
  const rawNext = searchParams.get('next') || '';
  const next =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/account/dashboard/';

  // Set by the idle auto-logout when it signs someone out, so the login page can
  // explain why they landed back here.
  const timedOut = searchParams.get('timeout');

  const supabase = createClient();

  // Is this browser trusted for the signed-in user? Cookie first (the form
  // the middleware can also verify), then the legacy localStorage slot.
  async function isTrustedBrowser(user) {
    const candidates = [];
    const cookieToken = readTrustCookie();
    if (cookieToken) candidates.push(cookieToken);
    const legacy = user ? readTrustStore()[user.id] : null;
    if (legacy?.token && legacy.exp > Date.now()) candidates.push(legacy.token);
    for (const token of candidates) {
      const hash = await sha256Hex(token);
      const { data: device } = await supabase
        .from('mfa_trusted_devices')
        .select('id, expires_at')
        .eq('token_hash', hash)
        .maybeSingle();
      if (device && new Date(device.expires_at).getTime() > Date.now()) {
        supabase
          .from('mfa_trusted_devices')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', device.id)
          .then(() => {});
        // Whichever store the token came from, make sure the COOKIE holds it
        // now -- the middleware trusts only the cookie, so a browser trusted
        // under the old localStorage scheme would otherwise pass here, get
        // sent onward, and be bounced right back, forever.
        writeTrustCookie(token, new Date(device.expires_at));
        return true;
      }
    }
    return false;
  }

  async function startChallenge() {
    const { data: list } = await supabase.auth.mfa.listFactors();
    const factor = (list?.totp ?? []).find((f) => f.status === 'verified');
    if (!factor) return false;
    const { data: ch, error: chError } = await supabase.auth.mfa.challenge({
      factorId: factor.id,
    });
    if (chError) return false;
    setMfa({ factorId: factor.id, challengeId: ch.id });
    setCode('');
    return true;
  }

  // A session can arrive at this page ALREADY half signed in: password
  // accepted, code never entered. That happens when someone backs out of the
  // code step and later returns, and when the middleware bounces such a
  // session off a protected page (it adds ?verify=1). Either way the right
  // thing is to resume at the code step, not to ask for the password again --
  // signInWithPassword already created the session; only the upgrade to aal2
  // is missing.
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel !== 'aal1' || aal?.nextLevel !== 'aal2') return;
      try {
        if (await isTrustedBrowser(user)) {
          finish();
          return;
        }
      } catch {
        /* fall through to the code step */
      }
      await startChallenge();
    })();
    // Run once on mount; the login flow drives everything after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Is this browser already trusted for this account? Look the local token
      // up server-side (RLS scopes the query to this user's own rows). Any
      // failure here just falls through to asking for the code -- never the
      // other way round.
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (await isTrustedBrowser(user)) {
          finish();
          return;
        }
      } catch {
        /* fall through to the code step */
      }

      const started = await startChallenge();
      if (started) {
        setBusy(false);
        return; // Show the code step instead of finishing the login.
      }
      setError('Could not start the two-factor step. Please try logging in again.');
      setBusy(false);
      return;
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

    // Passed two-factor. If asked, remember this browser: random token here,
    // its hash server-side (insert allowed only now, at aal2).
    if (remember) {
      try {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
        const hash = await sha256Hex(token);
        const expires = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { error: insError } = await supabase.from('mfa_trusted_devices').insert({
            profile_id: user.id,
            token_hash: hash,
            user_agent: navigator.userAgent.slice(0, 250),
            expires_at: expires.toISOString(),
          });
          if (!insError) {
            // Cookie first -- the middleware checks it. localStorage kept as
            // a same-browser backup in case cookies get cleared selectively.
            writeTrustCookie(token, expires);
            const store = readTrustStore();
            store[user.id] = { token, exp: expires.getTime() };
            writeTrustStore(store);
          }
        }
      } catch {
        /* trust is a convenience; the login itself has already succeeded */
      }
    }

    finish();
  }

  function finish() {
    // A FULL-DOCUMENT navigation, not router.push().
    //
    // Reported 23 Aug: the button stuck on "Logging in…" two or three times in
    // an evening of frequent deploys, and a manual refresh then landed
    // straight in the dashboard -- meaning the login had SUCCEEDED and only
    // the navigation was stuck.
    //
    // router.push() is a client-side navigation: it fetches the route's
    // payload from the deployment the page was loaded from. Deploy a new build
    // while someone has the login page open and those files are gone, so the
    // fetch fails, no render happens, and the page simply sits there. Nothing
    // resets the button because finish() never returned. A hard reload pulls
    // the new build and works, which is exactly the reported symptom.
    //
    // window.location.assign asks the server for a fresh document against the
    // CURRENT deployment, so a mid-session deploy cannot strand anyone. For a
    // post-login redirect that is the better behaviour anyway: the server
    // re-renders with the new session cookie, which is what the router.refresh()
    // below this was reaching for.
    //
    // `next` is sanitised at the top of this component to a path on this site.
    window.location.assign(next);

    // Belt and braces. A full-document navigation should never fail to leave
    // this page, but the failure we are fixing looked like a dead button, and
    // a dead button with no explanation is the worst version of any bug. If we
    // are somehow still here after five seconds, give the person something to
    // act on rather than a spinner that never stops.
    setTimeout(() => {
      setBusy(false);
      setError(
        'You are signed in, but this page did not move on. Please refresh, or go straight to your dashboard.'
      );
    }, 5000);
  }

  // --- the two-factor code step ---------------------------------------------
  if (mfa) {
    return (
      <form
        className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8"
        onSubmit={handleVerify}
      >
        <h2 className="text-2xl font-bold mb-1">Enter your code</h2>
        {searchParams.get('verify') && !error && (
          <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
            For your security, this page needs your two-factor code before
            continuing.
          </p>
        )}
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
          className="w-full rounded border border-neutral-300 px-4 py-2.5 mb-4 tracking-widest"
          placeholder="123456"
        />
        <label className="flex items-start gap-2 text-sm mb-6">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Remember this browser for {TRUST_DAYS} days — your password is still
            required, but not the code.{' '}
            <span className="text-neutral-500">
              (Leave unchecked on a shared or public computer.)
            </span>
          </span>
        </label>
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
