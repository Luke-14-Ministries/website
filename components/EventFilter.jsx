'use client';

// Choosing which event a staff page is about.
//
// Five pages grew their own version of this. Rosters used a dropdown listing
// every event ever; Activities, Dietary, Buddies and Rooms used pills plus a
// "Show past events" link that dumped the whole history into the same row of
// pills. Testing (25 Aug) put it plainly: it should be consistent, and past
// events want a searchable list rather than a toggle — "eg can type 2025 to
// filter to events from 2025".
//
// The split is by what the two lists are FOR. Current and upcoming events are
// a handful and are the reason you opened the page, so they are pills: no
// clicks, no reading. Past events are an archive that only grows, and you
// arrive at one knowing roughly what you want — so they get a search box.
//
// Every event stays reachable either way. Nothing is hidden in the database;
// this is about which few are one click away.

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// The same 30-day grace every staff page already used: a week that finished
// last Tuesday is still live work.
const cutoffISO = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

export function isCurrentEvent(e, cutoff = cutoffISO()) {
  return (e.endsOn ?? e.startsOn ?? '9999') >= cutoff;
}

export default function EventFilter({
  events = [],
  selected = null,
  basePath,
  // Query params to carry across when the event changes (e.g. a search box).
  extraParams = {},
  label = 'Event',
  // Some pages (Dietary, Check-In) legitimately show EVERY current event at
  // once — a kitchen list is not per-week. Those get an "All current" pill
  // that clears the selection rather than picking one.
  allowAll = false,
  allLabel = 'All current events',
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const cutoff = cutoffISO();
  const current = events.filter((e) => isCurrentEvent(e, cutoff));
  const past = events.filter((e) => !isCurrentEvent(e, cutoff));

  const href = (id) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) p.set(k, String(v));
    }
    if (id) p.set('event', id);
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // Matching on the whole visible string, so typing "2025" finds every event
  // that ran in 2025 even when the year is only in the dates.
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const withDates = past.map((e) => ({
      ...e,
      haystack: `${e.name} ${e.startsOn ?? ''} ${e.endsOn ?? ''}`.toLowerCase(),
    }));
    if (!needle) return withDates;
    return withDates.filter((e) => e.haystack.includes(needle));
  }, [past, q]);

  const selectedPast = past.find((e) => e.id === selected) ?? null;

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="sr-only">{label}</span>
        {allowAll && (
          <button
            type="button"
            onClick={() => router.push(href(null))}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              !selected
                ? 'bg-brand text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {allLabel}
          </button>
        )}
        {current.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => router.push(href(e.id))}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              e.id === selected
                ? 'bg-brand text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {e.name}
          </button>
        ))}

        {current.length === 0 && past.length > 0 && (
          <span className="text-sm text-neutral-500">
            Nothing current — pick a past event to look back at.
          </span>
        )}

        {past.length > 0 && (
          <div className="relative" ref={boxRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                selectedPast
                  ? 'border-brand bg-brand text-white'
                  : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {selectedPast ? selectedPast.name : `Past events (${past.length})`}
              <span aria-hidden className="ml-1.5 text-xs">
                ▾
              </span>
            </button>

            {open && (
              <div className="absolute left-0 z-30 mt-1 w-80 rounded-lg border border-neutral-300 bg-white p-2 shadow-lg">
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Type to filter — a name, or a year"
                  className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                />
                <ul className="mt-2 max-h-64 overflow-y-auto">
                  {matches.length === 0 ? (
                    <li className="px-2 py-2 text-sm text-neutral-500">
                      Nothing matches &ldquo;{q}&rdquo;.
                    </li>
                  ) : (
                    matches.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            router.push(href(e.id));
                          }}
                          className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 ${
                            e.id === selected ? 'font-bold text-brand' : ''
                          }`}
                        >
                          {e.name}
                          <span className="block text-xs text-neutral-500">
                            {e.startsOn}
                            {e.endsOn ? ` – ${e.endsOn}` : ''}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                {selectedPast && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(href(current[0]?.id ?? null));
                    }}
                    className="mt-2 w-full rounded px-2 py-1 text-left text-sm text-neutral-600 underline"
                  >
                    Back to current events
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
