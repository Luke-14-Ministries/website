'use client';

// Per-event registration controls. Times are entered and shown in YOUR local
// time zone (the browser's); they are stored as absolute moments, so a
// staffer in Tennessee and one traveling see the same instant rendered in
// their own clocks.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateEventRegistration } from './actions';

const money = (cents) =>
  cents == null ? '—' : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ISO timestamp <-> the browser's datetime-local input format, in local time.
const isoToLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localToIso = (v) => (v ? new Date(v).toISOString() : null);

function statusOf(row) {
  const now = new Date();
  if (!row.published) return ['Hidden', 'bg-neutral-200 text-neutral-600'];
  if (!row.hasPublishedOption)
    return ['No published price — cannot open', 'bg-red-100 text-red-800'];
  if (row.opensAt && new Date(row.opensAt) > now)
    return [`Opens ${new Date(row.opensAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, 'bg-amber-100 text-amber-800'];
  if (row.closesAt && new Date(row.closesAt) < now)
    return [`Closed ${new Date(row.closesAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, 'bg-neutral-200 text-neutral-600'];
  return ['Open now', 'bg-green-100 text-green-800'];
}

function EventRow({ e }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [published, setPublished] = useState(e.published);
  const [opens, setOpens] = useState(isoToLocal(e.opensAt));
  const [closes, setCloses] = useState(isoToLocal(e.closesAt));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, message }

  const dirty =
    published !== e.published ||
    opens !== isoToLocal(e.opensAt) ||
    closes !== isoToLocal(e.closesAt);

  const [statusLabel, statusClass] = statusOf({
    ...e,
    published,
    opensAt: localToIso(opens),
    closesAt: localToIso(closes),
  });

  function save() {
    setBusy(true);
    setNotice(null);
    start(async () => {
      const res = await updateEventRegistration(e.id, {
        published,
        opensAt: localToIso(opens),
        closesAt: localToIso(closes),
      });
      setBusy(false);
      setNotice(
        res.ok
          ? { ok: true, message: 'Saved — the public site reflects this immediately.' }
          : { ok: false, message: res.error }
      );
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold">{e.name}</p>
          <p className="text-sm text-neutral-500">
            {fmtDate(e.startsOn)} &ndash; {fmtDate(e.endsOn)} &middot; {money(e.feeCents)}/person
            {e.capacity ? ` · capacity ${e.capacity}` : ''}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="inline-flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={published}
            onChange={(ev) => setPublished(ev.target.checked)}
            className="h-4 w-4"
          />
          Visible on the site
        </label>
        <label className="text-sm">
          <span className="block text-neutral-500 mb-0.5">Registration opens</span>
          <input
            type="datetime-local"
            value={opens}
            onChange={(ev) => setOpens(ev.target.value)}
            className="rounded border border-neutral-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-neutral-500 mb-0.5">Registration closes</span>
          <input
            type="datetime-local"
            value={closes}
            onChange={(ev) => setCloses(ev.target.value)}
            className="rounded border border-neutral-300 px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="btn-primary !py-1.5 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {(opens || closes) && (
          <button
            type="button"
            onClick={() => {
              setOpens('');
              setCloses('');
            }}
            disabled={busy}
            className="text-sm text-neutral-600 underline"
          >
            Clear times
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Times are in your local time zone. Blank = no restriction on that end.
      </p>

      {notice && (
        <p
          className={`mt-2 rounded border px-3 py-2 text-sm ${
            notice.ok
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {notice.message}
        </p>
      )}
    </div>
  );
}

export default function SetupManager({ events }) {
  if (events.length === 0) {
    return (
      <p className="text-neutral-600">
        No events exist yet — events are currently created by the web admin;
        ask and one appears here with its controls.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {events.map((e) => (
        <EventRow key={e.id} e={e} />
      ))}
    </div>
  );
}
