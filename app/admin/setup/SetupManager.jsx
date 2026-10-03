'use client';

// Per-event registration controls. Times are entered and shown in YOUR local
// time zone (the browser's); they are stored as absolute moments, so a
// staffer in Tennessee and one traveling see the same instant rendered in
// their own clocks.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateEventRegistration, updateEventDetails, createEvent } from './actions';
import { EVENT_TYPE_LABELS } from '@/lib/events';

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

  // The event's own facts, behind a disclosure. Kept apart from the
  // registration window above deliberately: opening and closing registration
  // is a weekly act, and changing the DATE of camp is not. Putting them on one
  // row invites the second while doing the first.
  const [editing, setEditing] = useState(false);
  const [startsOn, setStartsOn] = useState(e.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(e.endsOn ?? '');
  const [capacity, setCapacity] = useState(e.capacity == null ? '' : String(e.capacity));
  const [fee, setFee] = useState(e.feeCents == null ? '' : (e.feeCents / 100).toFixed(2));
  // Early registration (0080): last day + $ off per person. Blank = none.
  const [earlyEndsOn, setEarlyEndsOn] = useState(e.earlyEndsOn ?? '');
  const [early, setEarly] = useState(e.earlyCents ? (e.earlyCents / 100).toFixed(2) : '');
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailNotice, setDetailNotice] = useState(null);

  function saveDetails() {
    setDetailBusy(true);
    setDetailNotice(null);
    start(async () => {
      const res = await updateEventDetails(e.id, {
        startsOn,
        endsOn,
        capacity,
        feeDollars: fee,
        earlyEndsOn,
        earlyDollars: early,
      });
      setDetailBusy(false);
      setDetailNotice(
        res.ok
          ? { ok: true, message: 'Saved. The public pages and the registration form use this now.' }
          : { ok: false, message: res.error }
      );
      if (res.ok) router.refresh();
    });
  }

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
          <p className="font-semibold">
            {e.name}{' '}
            <span className="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 align-middle text-xs font-medium text-neutral-600">
              {EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
            </span>
          </p>
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

      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className="mt-3 text-sm font-semibold text-brand underline"
      >
        {editing ? 'Close event details' : 'Edit dates, capacity, price and early registration'}
      </button>

      {editing && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">First day</span>
              <input
                type="date"
                value={startsOn}
                onChange={(ev) => setStartsOn(ev.target.value)}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Last day</span>
              <input
                type="date"
                value={endsOn}
                onChange={(ev) => setEndsOn(ev.target.value)}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Places</span>
              <input
                inputMode="numeric"
                value={capacity}
                onChange={(ev) => setCapacity(ev.target.value)}
                placeholder="no limit"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Price ($/person)</span>
              <input
                inputMode="decimal"
                value={fee}
                onChange={(ev) => setFee(ev.target.value)}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Early registration ends</span>
              <input
                type="date"
                value={earlyEndsOn}
                onChange={(ev) => setEarlyEndsOn(ev.target.value)}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Early discount ($/person)</span>
              <input
                inputMode="decimal"
                value={early}
                onChange={(ev) => setEarly(ev.target.value)}
                placeholder="none"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <p className="text-xs text-neutral-600 sm:col-span-2 self-end">
              People registered by the last day get this much off each, once the family is on
              a payment plan or has paid in full. A scholarship request alone does not earn it.
            </p>
          </div>

          {/* Said plainly, because the alternative behaviour is the one people
              assume: changing a price here does NOT re-price anyone already
              registered. Their fee was copied onto their row when they signed
              up and every balance and statement is built from it. */}
          <p className="mt-2 text-xs text-neutral-600">
            A new price applies to <strong>future</strong> registrations. People already
            registered keep the fee they signed up at — change an individual on their
            registration if that is what you mean. Capacity cannot be set below the number
            already registered.
          </p>

          {detailNotice && (
            <p
              className={`mt-2 rounded border px-3 py-2 text-sm ${
                detailNotice.ok
                  ? 'border-green-300 bg-green-50 text-green-800'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {detailNotice.message}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveDetails}
              disabled={detailBusy}
              className="btn-primary !py-1.5 text-sm disabled:opacity-40"
            >
              {detailBusy ? 'Saving…' : 'Save event details'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStartsOn(e.startsOn ?? '');
                setEndsOn(e.endsOn ?? '');
                setCapacity(e.capacity == null ? '' : String(e.capacity));
                setFee(e.feeCents == null ? '' : (e.feeCents / 100).toFixed(2));
                setEarlyEndsOn(e.earlyEndsOn ?? '');
                setEarly(e.earlyCents ? (e.earlyCents / 100).toFixed(2) : '');
                setDetailNotice(null);
              }}
              disabled={detailBusy}
              className="text-sm text-neutral-600 underline"
            >
              Undo my changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New event (2 Oct 2026). Hoisted to module level like EventRow -- a component
// defined inside another is remounted on every render (CLAUDE.md).
//
// Copying is the normal path: next year's Week 1 is this year's Week 1 with
// new dates. Choosing a source pre-fills everything from it, with the name's
// year bumped and the dates moved 52 weeks on (same weekdays), all editable.
// ---------------------------------------------------------------------------

const CAMP_GETS =
  'Camp: registration, payments, check-in and medical, plus rooms and cabins, buddies, programs and activities.';
const RETREAT_GETS =
  'Retreat: registration, payments, check-in and medical. Rooms, buddies and programs are sorted on arrival, so those pages leave it out.';

// 'YYYY-MM-DD' + n days, by parts (never new Date(iso), which is UTC midnight).
const addDays = (iso, n) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
const bumpYear = (name) => (name ?? '').replace(/\b(20\d\d)\b/, (y) => String(Number(y) + 1));
const dollars = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

const BLANK = {
  copyFrom: '',
  eventType: 'camp_week',
  name: '',
  startsOn: '',
  endsOn: '',
  fee: '',
  deposit: '50.00',
  capacity: '',
  location: '',
};

function NewEventPanel({ events }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const set = (k) => (ev) => setF((cur) => ({ ...cur, [k]: ev.target.value }));

  function chooseSource(id) {
    const src = events.find((e) => e.id === id);
    if (!src) {
      setF((cur) => ({ ...cur, copyFrom: '' }));
      return;
    }
    setF({
      copyFrom: id,
      eventType: src.eventType === 'retreat' ? 'retreat' : 'camp_week',
      name: bumpYear(src.name),
      startsOn: addDays(src.startsOn, 364),
      endsOn: addDays(src.endsOn, 364),
      fee: dollars(src.feeCents),
      deposit: dollars(src.depositCents),
      capacity: src.capacity == null ? '' : String(src.capacity),
      location: src.location ?? '',
    });
  }

  function submit() {
    setBusy(true);
    setNotice(null);
    start(async () => {
      const res = await createEvent({
        name: f.name,
        eventType: f.eventType,
        startsOn: f.startsOn,
        endsOn: f.endsOn,
        feeDollars: f.fee,
        depositDollars: f.deposit,
        capacity: f.capacity,
        location: f.location,
        copyFrom: f.copyFrom,
      });
      setBusy(false);
      if (res.ok) {
        setNotice({
          ok: true,
          message: `Created “${f.name.trim()}”. It is hidden: check its details below, then tick “Visible on the site” when registration should open.`,
        });
        setF(BLANK);
        setOpen(false);
        router.refresh();
      } else {
        setNotice({ ok: false, message: res.error });
      }
    });
  }

  const src = events.find((e) => e.id === f.copyFrom);

  return (
    <div className="mb-6">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="btn-primary !py-1.5 text-sm">
          + New event
        </button>
      ) : (
        <div className="rounded-lg border border-brand/40 bg-brand-light/30 p-4">
          <p className="font-semibold mb-3">New event</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Start from</span>
              <select
                value={f.copyFrom}
                onChange={(ev) => chooseSource(ev.target.value)}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              >
                <option value="">A blank event</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    Copy of {e.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="text-sm">
              <legend className="block font-semibold text-neutral-700 mb-0.5">Type</legend>
              <div className="flex gap-4 py-1">
                {[
                  ['camp_week', 'Camp'],
                  ['retreat', 'Retreat'],
                ].map(([v, label]) => (
                  <label key={v} className="inline-flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="new-event-type"
                      value={v}
                      checked={f.eventType === v}
                      onChange={set('eventType')}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            {f.eventType === 'retreat' ? RETREAT_GETS : CAMP_GETS}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="text-sm sm:col-span-2">
              <span className="block font-semibold text-neutral-700 mb-0.5">Name</span>
              <input
                value={f.name}
                onChange={set('name')}
                placeholder="Camp Celebrate 2028 — Week 1"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">First day</span>
              <input
                type="date"
                value={f.startsOn}
                onChange={set('startsOn')}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Last day</span>
              <input
                type="date"
                value={f.endsOn}
                onChange={set('endsOn')}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Price ($/person)</span>
              <input
                inputMode="decimal"
                value={f.fee}
                onChange={set('fee')}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Deposit ($/person)</span>
              <input
                inputMode="decimal"
                value={f.deposit}
                onChange={set('deposit')}
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Places</span>
              <input
                inputMode="numeric"
                value={f.capacity}
                onChange={set('capacity')}
                placeholder="no limit"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
            <label className="text-sm">
              <span className="block font-semibold text-neutral-700 mb-0.5">Location</span>
              <input
                value={f.location}
                onChange={set('location')}
                placeholder="optional"
                className="w-full rounded border border-neutral-300 px-2 py-1"
              />
            </label>
          </div>

          <p className="mt-3 text-xs text-neutral-600">
            {src ? (
              <>
                Copies from {src.name}: its description, agreements and activities
                {f.eventType === 'camp_week' ? ', and its rooms and cabins (empty, no one assigned)' : ''},
                with dates moved to match. People, assignments and program leaders are not copied.
              </>
            ) : (
              <>A blank event gets the standard agreements and nothing else; add activities
                {f.eventType === 'camp_week' ? ' and rooms (Rooms & Cabins can copy them from another event)' : ''} afterwards.</>
            )}{' '}
            {f.eventType === 'camp_week' && 'Volunteers are set to arrive the day before. '}
            The event starts <strong>hidden</strong>.
          </p>

          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="btn-primary !py-1.5 text-sm disabled:opacity-40"
            >
              {busy ? 'Creating…' : 'Create event'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setF(BLANK);
                setNotice(null);
              }}
              disabled={busy}
              className="text-sm text-neutral-600 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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

// ---------------------------------------------------------------------------
// Events grouped by the year they start (Lawrence, 2 Oct 2026). Now that staff
// make an event every year, the list only grows; a finished year folds away
// instead of being deleted, since its registrations and payments are history.
// A year stays open while any of its events is still running or ahead; once
// every event in it has ended it starts collapsed, one click from its controls.
// Native <details>, as on Staff & Access: no client state, and a group the
// staffer opened stays open across router.refresh().
// ---------------------------------------------------------------------------

const SUMMARY =
  'flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden';

function groupByYear(events) {
  const byYear = new Map();
  for (const e of events) {
    const year = (e.startsOn ?? '').slice(0, 4) || 'Undated';
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(e);
  }
  const groups = [...byYear].map(([year, list]) => ({
    year,
    list,
    past: list.every((e) => e.isPast),
  }));
  // Current and coming years first, earliest first; finished years after them,
  // newest first, so last year sits just below this one.
  return [
    ...groups.filter((g) => !g.past).sort((a, b) => a.year.localeCompare(b.year)),
    ...groups.filter((g) => g.past).sort((a, b) => b.year.localeCompare(a.year)),
  ];
}

function YearGroup({ year, list, past }) {
  const visible = list.filter((e) => e.published).length;
  return (
    <details open={!past} className="group rounded-lg border border-neutral-200">
      <summary className={`${SUMMARY} px-4 py-3`}>
        <span>
          <span className="font-bold">{year}</span>
          <span className="ml-2 text-sm text-neutral-500">
            {list.length} {list.length === 1 ? 'event' : 'events'} · {visible} visible
            {past ? ' · finished' : ''}
          </span>
        </span>
        <span aria-hidden="true" className="text-neutral-400 transition-transform group-open:rotate-180">
          &#9662;
        </span>
      </summary>
      <div className="space-y-4 border-t border-neutral-200 p-4">
        {list.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
      </div>
    </details>
  );
}

export default function SetupManager({ events }) {
  return (
    <div>
      <NewEventPanel events={events} />
      {events.length === 0 ? (
        <p className="text-neutral-600">No events yet. Use “New event” above to make the first.</p>
      ) : (
        <div className="space-y-4">
          {groupByYear(events).map((g) => (
            <YearGroup key={g.year} year={g.year} list={g.list} past={g.past} />
          ))}
        </div>
      )}
    </div>
  );
}
