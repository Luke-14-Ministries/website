// Server-side Turnstile verification. Server only -- the secret never ships.
//
// WHY THIS EXISTS, WHEN THE ACCOUNT FORMS NEEDED NOTHING LIKE IT
//
// The three account forms (sign-up, login, password reset) hand their token to
// Supabase as options.captchaToken, and Supabase's own servers call Cloudflare
// to check it. That is the right design there and components/Turnstile.jsx
// explains why: those forms call supabase.auth.* DIRECTLY from the browser, so
// a check of our own would sit in front of a call it cannot gate.
//
// The contact form has no such call. It posts to a server action of ours, and
// nothing else in the chain will verify anything. So the check has to be here,
// or it is decorative -- a widget that spins, says "success", and stops
// nothing. That is worse than no widget, because it looks like protection.
//
// CONSEQUENCE FOR CONFIGURATION, and it contradicts what this project used to
// say: the Turnstile SECRET key now belongs in TWO places -- pasted into the
// Supabase dashboard (for the auth forms) and set as TURNSTILE_SECRET_KEY in
// Vercel (for this). It is the same key pair either way; Cloudflare does not
// care who calls siteverify. Tokens are single-use, but each form issues its
// own, so the two uses never collide.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Returns { ok, skipped?, reason? }.
 *
 * ⚠️ THIS FAILS OPEN, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.
 *
 * If the secret is not configured, or Cloudflare cannot be reached, this
 * returns ok:true and logs loudly. The alternative -- refusing the message --
 * weighs a mailbox receiving spam against a family affected by disability
 * being unable to reach this ministry at all, through the one form on the site
 * that exists for exactly that. Those are not the same size of harm. Spam is
 * deleted in a second; the person who could not get through does not write
 * again, and nobody ever learns it happened.
 *
 * The warnings below are the safeguard. If they are in the log, the check is
 * not running, and somebody has to fix the configuration rather than assume
 * the quiet means it is working.
 */
export async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    // Same "unconfigured means inactive" pattern as Resend and Stripe here,
    // but it deserves a louder log than those two: they degrade a courtesy,
    // this degrades a control.
    console.warn(
      'verifyTurnstile: TURNSTILE_SECRET_KEY is not set — the bot check on the ' +
        'contact form is NOT running. Set it in Vercel (same secret pasted into ' +
        'the Supabase dashboard for the auth forms).'
    );
    return { ok: true, skipped: true };
  }

  if (!token) {
    // Refuse a missing token ONLY when the widget should have produced one --
    // that is, when the SITE key is configured too. Checking the secret alone
    // is not enough, and this is not hypothetical: on 30 Aug the Vercel
    // project had TURNSTILE_SECRET_KEY on Preview but NEXT_PUBLIC_TURNSTILE_
    // SITE_KEY on Production only. On a preview deployment that means no
    // widget renders, so no token exists, so a secret-only check would refuse
    // every message -- the contact form silently dead, on the exact
    // environment used for testing, with an error blaming the person for
    // failing a check they were never shown.
    //
    // The two keys are a pair. Reading both is what makes a half-configured
    // environment degrade to "off" rather than to "broken".
    if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      console.warn(
        'verifyTurnstile: secret is set but NEXT_PUBLIC_TURNSTILE_SITE_KEY is not, ' +
          'so no widget rendered and no token exists. Letting the message through. ' +
          'Set BOTH keys, in every environment, or neither.'
      );
      return { ok: true, skipped: true, reason: 'site-key-missing' };
    }
    return { ok: false, reason: 'missing-token' };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      console.error('verifyTurnstile: Cloudflare returned', res.status);
      return { ok: true, skipped: true, reason: 'verifier-unreachable' };
    }

    const data = await res.json();
    if (data.success) return { ok: true };

    // Cloudflare's own codes, kept in the log rather than shown to the person:
    // "timeout-or-duplicate" means a spent token, which is a retry, not an
    // accusation. The form says "please try the check again" either way.
    console.warn('verifyTurnstile: rejected —', (data['error-codes'] || []).join(', '));
    return { ok: false, reason: 'rejected' };
  } catch (err) {
    console.error('verifyTurnstile: network error —', err?.message);
    return { ok: true, skipped: true, reason: 'verifier-unreachable' };
  }
}
