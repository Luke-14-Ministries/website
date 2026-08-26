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
  // 'pills'  — current events as pills, past behind a search box.
  // 'search' — everything in one searchable list, "all" pinned at the top.
  //            Rosters wants this: it is a table filter over every event the
  //            ministry has ever run, and a row of pills for that is a wall
  //            (25 Aug).
  mode = 'pills',
  // Client-state pages (Rosters filters in the browser, not the URL) pass this
  // and nothing navigates.
  onSelect = null,
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const cutoff = cutoffISO();
  // In search mode there is no pill row at all, so every event goes into the
  // one list -- current ones first, because those are what people want.
  const searchOnly = mode === 'search';
  const current = searchOnly ? [] : events.filter((e) => isCurrentEvent(e, cutoff));
  const past = searchOnly
    ? [...events].sort(
        (a, b) =>
          (isCurrentEvent(b, cutoff) ? 1 : 0) - (isCurrentEvent(a, cutoff) ? 1 : 0) ||
          String(b.startsOn ?? '').localeCompare(String(a.startsOn ?? ''))
      )
    : events.filter((e) => !isCurrentEvent(e, cutoff));

  const choose = (id) => {
    if (onSelect) {
      onSelect(id ?? '');
      return;
    }
    router.push(href(id));
  };

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
            onClick={() => choose(null)}
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
            onClick={() => choose(e.id)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              e.id === selected
                ? 'bg-brand text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {e.name}
          </button>
        ))}

        {!searchOnly && current.length === 0 && past.length > 0 && (
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
              {selectedPast
                ? selectedPast.name
                : searchOnly
                  ? allLabel
                  : `Past events (${past.length})`}
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
                  {searchOnly && allowAll && (
                    <li className="border-b border-neutral-100 pb-1 mb-1">
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          choose(null);
                        }}
                        className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 ${
                          !selected ? 'font-bold text-brand' : ''
                        }`}
                      >
                        {allLabel}
                      </button>
                    </li>
                  )}
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
                            choose(e.id);
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
                      choose(current[0]?.id ?? null);
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
