'use server';

// The contact form actually sends now.
//
// Until 30 August 2026 this page had no server side at all: ContactForm.jsx
// called preventDefault(), set a "submitted" flag, showed a thank-you, and
// dropped the message. Meanwhile the page around it said "please don't
// hesitate to reach out using the contact form." That was safe while only
// staff were testing and stops being safe the moment the preview link reaches
// anyone who might use it in good faith.
//
// WHAT THIS DOES NOT DO: it stores nothing. There is no contact_messages
// table, and that is deliberate rather than unfinished. A message goes to the
// shared mailbox, where staff already work, where it can be replied to, filed
// and searched with the tools they already know. A table would mean a
// migration, policies, grants, an admin page nobody has a habit of opening,
// and a second place holding what the public writes to a disability ministry.
// Email is the boring option and the boring option is the rule here.

import { headers } from 'next/headers';
import { emailLooksValid } from '@/lib/format';
import { sendEmail, contactMessageEmail } from '@/lib/email';
import { verifyTurnstile } from '@/lib/turnstile';
import { site } from '@/lib/site';

// Long enough to hold anything a person would actually write, short enough
// that a script cannot post a novel. Trimmed rather than rejected at the
// edges: someone who pastes a long message should not lose it to a limit.
const MAX = { name: 120, email: 200, subject: 200, message: 5000 };

const clean = (v, n) => String(v ?? '').trim().slice(0, n);

export async function sendContactMessage(form) {
  const name = clean(form?.name, MAX.name);
  const email = clean(form?.email, MAX.email);
  const subject = clean(form?.subject, MAX.subject);
  const message = clean(form?.message, MAX.message);

  // Validated again here, not only in the browser. The form checks these too
  // so the person is told early; this is the check that actually holds, since
  // a server action is a public endpoint whatever the page in front of it does.
  if (!name) return { ok: false, error: 'Please tell us your name.' };
  if (!emailLooksValid(email)) {
    return { ok: false, error: 'That email address doesn’t look right — please check it.' };
  }
  if (!message) return { ok: false, error: 'Please write a message.' };

  // The bot check. See lib/turnstile.js for why it lives here rather than
  // riding along on a Supabase call the way the account forms do, and for why
  // an unreachable verifier lets the message through rather than blocking it.
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  const check = await verifyTurnstile(form?.captchaToken, ip);
  if (!check.ok) {
    return {
      ok: false,
      // Never "you look like a bot". A real person hitting this has done
      // nothing wrong -- most often the token simply expired while they were
      // still typing -- and being accused is a poor first contact with a
      // ministry. The form resets the widget so the retry can succeed.
      error: 'That check timed out. Please tick the box again and resend.',
      retryCaptcha: true,
    };
  }

  const { subject: emailSubject, html } = contactMessageEmail({
    name,
    email,
    subject,
    message,
  });

  const sent = await sendEmail({
    to: site.emails.info,
    subject: emailSubject,
    html,
    // Reply goes to the person who wrote in, not to the ministry's own
    // registration address, which is what Resend sends everything else as.
    replyTo: email,
  });

  // The one place in this project where a failed send is NOT tolerable.
  // Everywhere else the email is a courtesy attached to something already
  // saved -- a registration exists whether or not its confirmation arrives.
  // Here the email IS the record. If it did not go, nothing happened, and
  // telling someone "thank you, we'll be in touch" would be untrue.
  if (!sent.ok) {
    return {
      ok: false,
      error:
        'Sorry — we could not send that just now. Please email us directly at ' +
        `${site.emails.info}, or call (423) 748-4954.`,
    };
  }

  return { ok: true };
}
