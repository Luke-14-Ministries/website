'use client';

// Name/phone, login-email change (goes through Supabase Auth's confirmation
// email), and email preferences. Transactional email -- receipts,
// confirmations, password resets -- always sends; the preference only covers
// ministry news & updates.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateMyProfile, requestLoginEmailChange, setEmailNews } from './actions';

const inputCls = 'w-full rounded border border-neutral-300 px-3 py-2';

export default function ContactManager({ email, profile }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [msg, setMsg] = useState({});

  function run(key, fn) {
    setMsg((m) => ({ ...m, [key]: { state: 'saving' } }));
    start(async () => {
      const res = await fn();
      setMsg((m) => ({
        ...m,
        [key]: res.ok
          ? { state: 'ok', text: res.message ?? 'Saved ✓' }
          : { state: 'err', text: res.error },
      }));
      router.refresh();
    });
  }

  const Status = ({ k }) => {
    const s = msg[k];
    if (!s) return null;
    if (s.state === 'saving') return <span className="text-sm text-neutral-500">Saving…</span>;
    return (
      <span className={`text-sm ${s.state === 'ok' ? 'text-green-700' : 'text-red-700'}`}>
        {s.text}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Name & personal phone */}
      <form
        className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          run('profile', () => updateMyProfile(f));
        }}
      >
        <h2 className="text-lg font-bold mb-1">My name &amp; phone</h2>
        <p className="text-sm text-neutral-500 mb-4">
          How your name appears across the site, and your own cell number.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-sm font-semibold mb-1">First name</span>
            <input name="first_name" defaultValue={profile.first_name} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-sm font-semibold mb-1">Last name</span>
            <input name="last_name" defaultValue={profile.last_name} className={inputCls} />
          </label>
          <label className="block">
            <span className="block text-sm font-semibold mb-1">My phone</span>
            <input name="phone" type="tel" defaultValue={profile.phone} className={inputCls} />
          </label>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              name="sms_opt_in"
              defaultChecked={profile.sms_opt_in}
              className="h-4 w-4"
            />
            <span className="text-sm">OK to text me at this number</span>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" className="btn-primary !py-2">Save</button>
          <Status k="profile" />
        </div>
      </form>

      {/* Login email */}
      <form
        className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          run('email', () => requestLoginEmailChange(f.new_email));
        }}
      >
        <h2 className="text-lg font-bold mb-1">Login email</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Currently <span className="font-semibold">{email}</span>. To change it, enter the new
          address — we&rsquo;ll email it a confirmation link, and nothing changes until you click
          it.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[16rem]">
            <span className="block text-sm font-semibold mb-1">New email address</span>
            <input name="new_email" type="email" required className={inputCls} />
          </label>
          <button type="submit" className="btn-outline !py-2">Send confirmation</button>
        </div>
        <div className="mt-2">
          <Status k="email" />
        </div>
      </form>

      {/* Email preferences */}
      <div id="email-preferences" className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
        <h2 className="text-lg font-bold mb-1">Email preferences</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Receipts, registration confirmations, and account emails always send — this only
          controls optional mail.
        </p>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            defaultChecked={profile.email_news}
            onChange={(e) => run('news', () => setEmailNews(e.target.checked))}
            className="h-4 w-4"
          />
          <span>Ministry news &amp; updates (camp announcements, newsletters)</span>
        </label>
        <div className="mt-2">
          <Status k="news" />
        </div>
      </div>
    </div>
  );
}
