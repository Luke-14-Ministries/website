'use client';

import { useState } from 'react';
import { requestDataDeletion } from './actions';

export default function DeleteDataForm() {
  const [scope, setScope] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit() {
    if (scope === 'account_and_medical') {
      const ok = window.confirm(
        'Ask us to delete your account and everyone in your household?\n\nStaff will contact you before anything is removed.'
      );
      if (!ok) return;
    }
    setBusy(true);
    const res = await requestDataDeletion({ scope, note });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: 'Thank you. Your request is with camp staff, who will be in touch.' } : { ok: false, text: res.error });
  }

  if (msg?.ok) {
    return <p className="rounded border border-green-300 bg-green-50 px-4 py-3 text-green-900">{msg.text}</p>;
  }
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <label className="flex items-start gap-3 rounded border border-neutral-300 p-3 cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand-light">
          <input type="radio" name="scope" className="mt-1" checked={scope === 'medical'} onChange={() => setScope('medical')} />
          <span>
            <span className="font-semibold">Delete our medical information</span>
            <span className="block text-sm text-neutral-600">
              Allergies, medications, support needs and similar details for everyone in your household. Your account stays.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded border border-neutral-300 p-3 cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand-light">
          <input type="radio" name="scope" className="mt-1" checked={scope === 'account_and_medical'} onChange={() => setScope('account_and_medical')} />
          <span>
            <span className="font-semibold">Delete our account and medical information</span>
            <span className="block text-sm text-neutral-600">Your login, your household and everyone in it.</span>
          </span>
        </label>
      </fieldset>
      <div>
        <label className="block text-sm font-semibold text-neutral-700 mb-1">Anything we should know? (optional)</label>
        <textarea className="w-full rounded border border-neutral-300 px-3 py-2" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {msg && !msg.ok && <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{msg.text}</p>}
      <button type="button" className="btn-primary !py-2 disabled:opacity-50" disabled={!scope || busy} onClick={submit}>
        {busy ? 'Sending…' : 'Send request'}
      </button>
    </div>
  );
}
