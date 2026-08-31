'use client';

import { useState } from 'react';
import Turnstile, { turnstileEnabled } from '@/components/Turnstile';
import { sendContactMessage } from './actions';

const FIELD =
  'w-full rounded border border-neutral-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-brand';

export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [captchaToken, setCaptchaToken] = useState(null);
  // Bumped to force a fresh Turnstile token. Tokens are single use, so any
  // failed submit has spent one and the retry needs another -- without this a
  // second attempt fails for a reason that has nothing to do with the person.
  const [captchaBump, setCaptchaBump] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (turnstileEnabled && !captchaToken) {
      setError('Please complete the “I am human” check just above the button.');
      return;
    }

    setBusy(true);
    const res = await sendContactMessage({ ...form, captchaToken });
    setBusy(false);

    if (!res?.ok) {
      setError(res?.error || 'Sorry — something went wrong. Please try again.');
      // Spend-and-replace, always: the token is gone either way once the
      // server has looked at it.
      setCaptchaToken(null);
      setCaptchaBump((n) => n + 1);
      return;
    }
    setSent(true);
  }

  // Replaces the form rather than sitting under it. Leaving a filled-in form
  // on screen next to "thank you" invites a second send of the same message,
  // which is how a shared mailbox ends up with duplicates nobody can tell apart.
  if (sent) {
    return (
      <div
        role="status"
        className="rounded border border-brand bg-brand-light px-5 py-6 text-brand-dark"
      >
        <p className="text-lg font-bold">Thank you — your message is on its way.</p>
        <p className="mt-2">
          Someone from Luke 14 Ministries will read it and get back to you at{' '}
          <span className="font-semibold">{form.email}</span>. If it is urgent, please call{' '}
          <a href="tel:+14237484954" className="font-semibold underline">
            (423) 748-4954
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className="block font-semibold mb-1">
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={form.name}
          onChange={set('name')}
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="email" className="block font-semibold mb-1">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={form.email}
          onChange={set('email')}
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="subject" className="block font-semibold mb-1">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          value={form.subject}
          onChange={set('subject')}
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="message" className="block font-semibold mb-1">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={6}
          required
          value={form.message}
          onChange={set('message')}
          className={FIELD}
        />
      </div>

      {/* Renders nothing at all when no site key is configured -- see
          components/Turnstile.jsx. The form still works in that case; the
          server logs loudly that the check is not running. */}
      <Turnstile onToken={setCaptchaToken} resetKey={captchaBump} action="contact" />

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Sending…' : 'Send Message'}
      </button>

      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-4 py-3 font-semibold text-red-800"
        >
          {error}
        </p>
      )}
    </form>
  );
}
