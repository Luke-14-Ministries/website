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
// clicks, no reading. Everything else — finished events, and anything booked
// more than a year out — is an archive that only grows, and you arrive at one
// knowing roughly what you want, so it gets a search box.
//
// Every event stays reachable either way. Nothing is hidden in the database;
// this is about which few are one click away.

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// "Current" has two edges, not one.
//
// BEHIND: a 30-day grace, the same one every staff page already used — a week
// that finished last Tuesday is still live work.
//
// AHEAD: twelve months (agreed 25 Aug). Without it, an event booked three
// years out sits in the pill row from the day it is created, and a row meant
// to say "what is happening now" slowly becomes a list of everything.
// Anything further off is still one search away.
const cutoffISO = () => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const horizonISO = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

export function isCurrentEvent(e, cutoff = cutoffISO(), horizon = horizonISO()) {
  const ends = e.endsOn ?? e.startsOn ?? '9999';
  const starts = e.startsOn ?? e.endsOn ?? '0000';
  return ends >= cutoff && starts <= horizon;
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
  const horizon = horizonISO();
  // In search mode there is no pill row at all, so every event goes into the
  // one list -- current ones first, because those are what people want.
  const searchOnly = mode === 'search';
  const current = searchOnly ? [] : events.filter((e) => isCurrentEvent(e, cutoff, horizon));
  const past = searchOnly
    ? [...events].sort((a, b) => {
        // TWO TIERS, and each sorts the opposite way. Corrected 31 Aug 2026:
        // this sorted everything descending, so the roster's event list opened
        // with the camp furthest in the future — Week 2 above Week 1, and the
        // retreat happening this October last of the three.
        //
        // Current events ascending: the soonest is the one being worked on.
        // Past events descending: the one that just finished is the one anybody
        // still has questions about, and 2019 can stay at the bottom.
        //
        // This is the same rule the family dashboard already documents — "a
        // plain ascending sort by date puts last month's camp above next
        // month's retreat" — so the two now agree.
        const aCur = isCurrentEvent(a, cutoff, horizon);
        const bCur = isCurrentEvent(b, cutoff, horizon);
        if (aCur !== bCur) return aCur ? -1 : 1;
        const as = String(a.startsOn ?? '');
        const bs = String(b.startsOn ?? '');
        return aCur ? as.localeCompare(bs) : bs.localeCompare(as);
      })
    : events.filter((e) => !isCurrentEvent(e, cutoff, horizon));

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
    // No bottom margin in search mode: there the component is ONE control
    // inside somebody else's filter row (the roster header), and mb-6 there
    // pushes the whole row apart from the inside. In pill mode it is a block
    // of its own and the margin is right.
    <div className={searchOnly ? '' : 'mb-6'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="sr-only">{label}</span>
        {/* In search mode "all" lives pinned at the top of the list, so a
            standalone pill beside it is the same control twice (25 Aug). */}
        {allowAll && !searchOnly && (
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
            Nothing current — pick an event from the list.
          </span>
        )}

        {past.length > 0 && (
          <div className="relative" ref={boxRef}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              // Two shapes, because this button appears in two places. In the
              // pill row (Dietary, Programs) it is one pill among pills. In
              // SEARCH mode it is the first control in a row of native
              // <select>s, and a rounded-full pill at py-1 beside three square
              // boxes at py-1.5 is why the roster header never lined up.
              className={
                searchOnly
                  ? `rounded border px-3 py-1.5 text-sm bg-white ${
                      selectedPast
                        ? 'border-brand text-brand-dark font-semibold'
                        : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                    }`
                  : `rounded-full border px-3 py-1 text-sm font-semibold ${
                      selectedPast
                        ? 'border-brand bg-brand text-white'
                        : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                    }`
              }
            >
              {selectedPast
                ? selectedPast.name
                : searchOnly
                  ? allLabel
                  : `Other events (${past.length})`}
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
