'use client';

// The event's medical contact (camp doctor / nurse), shown to all staff on the
// day-of pages. Not sensitive information -- the sensitive gate protects
// campers' details, not the doctor's phone number. Admins can edit in place.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setEventMedicalContact } from './actions';

export default function MedicalContact({ eventId, name, phone, canEdit }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm">
        <span aria-hidden>⚕️</span>
        {name ? (
          <span>
            <span className="font-semibold">Medical contact:</span> {name}
            {phone ? <span className="font-semibold"> · {phone}</span> : null}
          </span>
        ) : (
          <span className="text-neutral-600">No medical contact set for this event yet.</span>
        )}
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="ml-auto text-brand font-semibold hover:underline"
          >
            {name ? 'Edit' : 'Set contact'}
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        setError('');
        setSaving(true);
        start(async () => {
          const res = await setEventMedicalContact(eventId, f.name, f.phone);
          setSaving(false);
          if (!res.ok) setError(res.error);
          else setEditing(false);
          router.refresh();
        });
      }}
    >
      <label className="block">
        <span className="block text-xs font-semibold mb-1">Name / role</span>
        <input
          name="name"
          defaultValue={name ?? ''}
          placeholder="Dr. Jane Smith (camp doctor)"
          className="rounded border border-neutral-300 px-3 py-1.5 min-w-[16rem]"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-semibold mb-1">Phone</span>
        <input
          name="phone"
          type="tel"
          defaultValue={phone ?? ''}
          className="rounded border border-neutral-300 px-3 py-1.5"
        />
      </label>
      <button type="submit" disabled={saving} className="btn-primary !py-1.5">
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-neutral-600 font-semibold hover:underline"
      >
        Cancel
      </button>
      {error && <span className="text-red-700 w-full">{error}</span>}
    </form>
  );
}
