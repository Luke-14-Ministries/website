'use client';

// One registration on the family dashboard, collapsible to its own title bar.
//
// A family with three registrations was scrolling past three full cards to
// reach anything below them (asked for 25 Aug). Collapsing is the fix, but a
// collapse that hides something the family needs to ACT on is worse than the
// scrolling was — the deposit banner in particular exists to be seen.
//
// So two rules govern this:
//
//   1. The title bar carries the status. Whatever is outstanding — a deposit
//      due, a balance owing — is named on the bar itself, so a collapsed card
//      still says what it wants. A bar that reads only "Camp Celebrate · 2
//      people · $960" hides the one thing that mattered.
//
//   2. Anything needing attention opens itself. `defaultOpen` is decided by
//      the server from real payment state, not by position in the list. A
//      single registration also opens, because there is nothing to tidy when
//      there is only one of them.
//
// State is deliberately NOT persisted. A remembered collapse would fight rule
// 2 — a family who collapsed a card in June would not see July's deposit ask —
// and predictable beats clever on a page about money.

import { useState } from 'react';

export default function RegistrationCard({
  eventName,
  dateLabel = '',
  past = false,
  peopleLabel,
  totalLabel,
  // One or more pills. An array, because a registration can be two things at
  // once -- owing a balance AND still needing its deposit -- and squeezing
  // both into one pill made the same slot mean different things on different
  // cards: "$1,400 balance" beside "$50 deposit due" invites the reader to
  // compare two numbers that are not comparable (flagged 26 Aug).
  status,          // [{ text, tone }] | { text, tone } | null
  defaultOpen = false,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  const pills = (Array.isArray(status) ? status : status ? [status] : []).filter(Boolean);

  const toneClass = (tone) =>
    tone === 'amber'
      ? 'bg-amber-100 text-amber-800'
      : tone === 'ask'
        // The immediate ask, not just a fact about the account. Solid, so it
        // reads as the thing to act on when it sits beside the balance.
        ? 'bg-amber-500 text-white'
        : tone === 'green'
          ? 'bg-green-100 text-green-800'
          : 'bg-neutral-100 text-neutral-600';

  return (
    <div className="rounded border border-neutral-200">
      {/* A real button, not a clickable div: it has to be reachable by keyboard
          and announce its own state, since it governs everything below it. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-neutral-50 rounded"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={`shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          <span className="font-semibold">{eventName}</span>
          {dateLabel && (
            <span className="shrink-0 text-sm text-neutral-500">{dateLabel}</span>
          )}
          {past && (
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500">
              past
            </span>
          )}
          {pills.map((p, i) => (
            <span
              key={i}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneClass(p.tone)}`}
            >
              {p.text}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-3 text-sm text-neutral-600">
          <span>
            {peopleLabel} · Total {totalLabel}
          </span>
          <span className="text-xs text-neutral-400">{open ? 'Hide' : 'Show'}</span>
        </span>
      </button>

      {/* Unmounted rather than hidden with CSS: the body holds live controls
          (the pay panel, links), and leaving them in the tree but invisible
          puts focusable elements where a keyboard user cannot see them. */}
      {open && <div className="border-t border-neutral-200 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}
