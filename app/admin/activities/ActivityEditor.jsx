'use client';

// Editing an activity, and adding one.
//
// Camp changes what it offers — between weeks, between years, and sometimes on
// a phone call with an outfitter. Testing (25 Aug) asked the obvious question
// about zip line: "where do we activate things like this? Have to go through
// you, right now? doesn't seem sensible." It isn't. This is the answer.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createActivity,
  updateActivity,
  deleteActivity,
  setActivityActive,
} from './actions';

const input = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm';
const label = 'block text-xs font-semibold text-neutral-700 mb-0.5';

function Fields({ f, set }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={label}>Name</span>
          <input className={input} value={f.name} onChange={set('name')} />
        </label>
        <label className="text-sm">
          <span className={label}>Order on the page</span>
          <input
            className={input}
            inputMode="numeric"
            value={f.sortOrder}
            onChange={set('sortOrder')}
            placeholder="10, 20, 30…"
          />
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className={label}>
          Description{' '}
          <span className="font-normal text-neutral-500">
            — what a family reads. Say when it usually happens.
          </span>
        </span>
        <textarea
          rows={2}
          className={input}
          value={f.description}
          onChange={set('description')}
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={label}>How it books</span>
          <select className={input} value={f.mode} onChange={set('mode')}>
            <option value="interest">Interest — just tell us who fancies it</option>
            <option value="signup">Sign-up — holds a place</option>
          </select>
        </label>
        <label className="text-sm">
          <span className={label}>
            Places{' '}
            <span className="font-normal text-neutral-500">
              {f.mode === 'interest' ? '— not used for interest' : '— blank means no limit'}
            </span>
          </span>
          <input
            className={input}
            inputMode="numeric"
            value={f.mode === 'interest' ? '' : f.capacity}
            onChange={set('capacity')}
            disabled={f.mode === 'interest'}
            placeholder="no limit"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={label}>
            Outside provider{' '}
            <span className="font-normal text-neutral-500">— blank if camp runs it</span>
          </span>
          <input
            className={input}
            value={f.providerName}
            onChange={set('providerName')}
            placeholder="e.g. River outfitter"
          />
        </label>
        <label className="text-sm">
          <span className={label}>Their link (optional)</span>
          <input className={input} value={f.providerUrl} onChange={set('providerUrl')} />
        </label>
      </div>
      {/* Naming a provider is not cosmetic: it is what makes the family's page
          say the outfitter has a form of their own, and what puts the
          told / not told pills on this page. */}
      {f.providerName.trim() && (
        <p className="mt-1 text-xs text-amber-800">
          Families will be told {f.providerName.trim()} has their own form to complete, and
          asked to confirm they understand.
        </p>
      )}
    </>
  );
}

export function ActivityEditor({ activity }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    name: activity.name ?? '',
    description: activity.description ?? '',
    mode: activity.booking_mode ?? 'interest',
    capacity: activity.capacity == null ? '' : String(activity.capacity),
    providerName: activity.provider_name ?? '',
    providerUrl: activity.provider_url ?? '',
    sortOrder: String(activity.sort_order ?? 0),
    active: activity.active !== false,
  });
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  function run(fn) {
    setError('');
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button onClick={() => setOpen((v) => !v)} className="text-brand underline">
          {open ? 'Close' : 'Edit this activity'}
        </button>
        <button
          onClick={() =>
            run(() => setActivityActive(activity.id, !(activity.active !== false)))
          }
          disabled={pending}
          className="text-brand underline"
        >
          {activity.active !== false ? 'Turn off (hide from families)' : 'Turn back on'}
        </button>
      </div>

      {!open && error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}

      {open && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <Fields f={f} set={set} />

          {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => run(() => updateActivity(activity.id, { ...f, active: f.active }))}
              disabled={pending}
              className="btn-primary !py-1.5 text-sm disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setOpen(false)}
              disabled={pending}
              className="text-sm text-neutral-600 underline"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (
                  !confirm(
                    `Remove "${activity.name}" from this event?\n\nThis is only possible while nobody has put their name down. If anyone has, turn it off instead — that hides it and keeps the record.`
                  )
                )
                  return;
                run(() => deleteActivity(activity.id));
              }}
              disabled={pending}
              className="ml-auto text-sm text-red-700 underline"
            >
              Remove from this event
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AddActivity({ eventId, eventName }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const blank = {
    name: '',
    description: '',
    mode: 'interest',
    capacity: '',
    providerName: '',
    providerUrl: '',
    sortOrder: '50',
    active: true,
  };
  const [f, setF] = useState(blank);
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline !py-2 text-sm">
        + Add an activity to {eventName || 'this event'}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-5">
      <h3 className="font-bold mb-3">Add an activity</h3>
      <Fields f={f} set={set} />
      {error && <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={() => {
            setError('');
            start(async () => {
              const res = await createActivity(eventId, f);
              if (!res.ok) setError(res.error);
              else {
                setF(blank);
                setOpen(false);
                router.refresh();
              }
            });
          }}
          disabled={pending}
          className="btn-primary !py-1.5 text-sm disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add it'}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError('');
          }}
          disabled={pending}
          className="text-sm text-neutral-600 underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
