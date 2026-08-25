'use client';

// Cloudflare Turnstile — the bot check on the three public auth forms.
//
// HOW THIS FITS TOGETHER (worth reading before changing anything here):
//
// The site does NOT verify the token itself. Supabase Auth has native captcha
// support, so the token rides along on signUp / signInWithPassword /
// resetPasswordForEmail as options.captchaToken, and Supabase's own servers
// call Cloudflare to verify it. That is better than a verifier of our own for
// one specific reason: these forms call supabase.auth.* DIRECTLY from the
// browser, with no server action in between. A check we wrote ourselves would
// have to sit in front of a call it cannot actually gate — a lock on a door
// beside an open window. Supabase enforcing it at the Auth endpoint closes the
// window.
//
// ⚠️ THE SEQUENCING HAZARD — this can take the site down.
// Turning captcha ON in the Supabase dashboard makes EVERY auth endpoint
// demand a token immediately. If the site key is not deployed here, no token
// exists, and every login and signup fails for everyone. The order is:
//
//   1. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY in Vercel and deploy.
//   2. Confirm the widget actually renders on /account/signup/.
//   3. ONLY THEN enable captcha in Supabase (Auth → Settings → Bot and Abuse
//      Protection) and paste the SECRET key there.
//
// To undo a mistake, disable it in the Supabase dashboard — not here.
//
// With no site key set, this renders nothing and reports a null token, which
// is exactly right while Supabase-side captcha is still off. Same
// "unconfigured means inactive" pattern as Resend and Stripe.

import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Exported so forms can tell "no token yet" from "no captcha configured" —
// two states that must never produce the same error message.
export const turnstileEnabled = Boolean(SITE_KEY);

// One script tag per page, however many widgets ask for it.
let scriptPromise = null;
function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.turnstile ?? null);
    // Resolve null rather than reject: Cloudflare being unreachable should
    // surface as "the check could not load", not as an unhandled rejection.
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * onToken(token|null) fires when a token is issued, expires, or errors.
 * resetKey — change it (e.g. a counter bumped on submit failure) to force a
 *   fresh token. Turnstile tokens are SINGLE USE: after any failed submit the
 *   spent token must be replaced or the retry fails for the wrong reason.
 */
export default function Turnstile({ onToken, resetKey = 0, className = '' }) {
  const boxRef = useRef(null);
  const widgetIdRef = useRef(null);
  // Held in a ref so the render effect never re-runs just because the parent
  // re-rendered with a new callback identity — re-rendering the widget would
  // throw away a perfectly good token.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    loadTurnstile().then((turnstile) => {
      if (cancelled || !turnstile || !boxRef.current) return;
      // Strict mode mounts effects twice in development; without this guard
      // that leaves two widgets stacked on the page.
      if (widgetIdRef.current !== null) return;

      widgetIdRef.current = turnstile.render(boxRef.current, {
        sitekey: SITE_KEY,
        callback: (token) => onTokenRef.current?.(token),
        'expired-callback': () => onTokenRef.current?.(null),
        'error-callback': () => onTokenRef.current?.(null),
        theme: 'light',
        action: 'auth',
      });
    });

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Already gone; nothing to clean up.
        }
        widgetIdRef.current = null;
      }
    };
  }, []);

  // Spend-and-replace on demand.
  useEffect(() => {
    if (!resetKey || widgetIdRef.current === null || !window.turnstile) return;
    try {
      window.turnstile.reset(widgetIdRef.current);
      onTokenRef.current?.(null);
    } catch {
      // A widget that will not reset is not worth breaking the form over.
    }
  }, [resetKey]);

  if (!SITE_KEY) return null;

  return <div ref={boxRef} className={className} />;
}
