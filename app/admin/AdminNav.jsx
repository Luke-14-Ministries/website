'use client';

// The admin sidebar: Overview on top, an expandable "Events" group holding
// everything event-scoped (rosters, check-in, changes, dietary, medical,
// volunteers, activities, buddies, payments), and org-level pages below.
// The group remembers open/closed per browser.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const OPEN_KEY = 'l14_admin_nav_events_open';

// Two kinds of number, and the difference is NOT whether a human should look
// -- both deserve eyes (24 Aug). It is whether looking makes the number go
// away:
//
//   amber  a queue that DRAINS. Review the item and it leaves the count;
//          zero is reachable and means "nothing outstanding".
//   blue   a rolling seven-day window. It shrinks with time, not with
//          action, and can never be cleared.
//
// Mixing them costs the amber ones their meaning: a badge nobody can ever
// clear teaches staff that badges are wallpaper, and then the two that really
// are to-do lists stop being read as to-do lists.
const BADGE_TONE = {
  '/admin/accounts': 'window',
  '/admin/payments': 'window',
  // A program leader's own count is not a to-do list -- nobody can act on it
  // and make it smaller. It answers "how big is my group?", which is the
  // question they came for. Blue.
  //
  // Note what is NOT here: /admin/programs stays amber, because unplaced
  // people ARE a queue -- place them and it reaches zero.
  '/admin/my-program': 'window',
};

export default function AdminNav({ top, events, rest, badges = {}, badgeTitles = {} }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(OPEN_KEY);
      if (saved === '0') setOpen(false);
    } catch {}
  }, []);

  function toggle() {
    setOpen((o) => {
      try {
        window.localStorage.setItem(OPEN_KEY, o ? '0' : '1');
      } catch {}
      return !o;
    });
  }

  const isActive = (href) =>
    pathname === href ||
    pathname === `${href}/` ||
    (href !== '/admin' && pathname?.startsWith(`${href}/`)) ||
    // A registration detail page is reached FROM the roster, so Rosters stays
    // lit while inside one -- the trail back stays visible (24 Aug).
    (href === '/admin/rosters' && pathname?.startsWith('/admin/registrations'));

  // "You are here" in the ministry's own teal, with a solid left edge doing
  // most of the work. Grey-200 read as a warm, faintly alarming wash next to
  // the amber count badges (24 Aug); a colour from the palette says "current
  // page" without suggesting anything is wrong. The bold weight and the bar
  // mean the state survives if colour alone is hard to see.
  const Item = ({ n, indent = false }) =>
    n.ready ? (
      <Link
        href={n.href}
        aria-current={isActive(n.href) ? 'page' : undefined}
        // flex, not block: a label long enough to wrap used to push its badge
        // onto a line of its own, which read as a stray number under the item
        // rather than a count on it (25 Aug). Now the label takes the room it
        // needs and the badge holds its place at the end.
        className={`flex items-center justify-between gap-2 rounded px-3 py-2 font-medium hover:bg-brand-light/60 ${
          indent ? 'ml-4' : ''
        } ${
          isActive(n.href)
            ? 'bg-brand-light text-brand-dark font-semibold border-l-4 border-brand pl-2'
            : ''
        }`}
      >
        <span className="min-w-0">{n.label}</span>
        {(badges[n.href] ?? 0) > 0 && (
          <span
            title={`${badges[n.href]} ${badgeTitles[n.href] ?? 'needing review'}`}
            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
              BADGE_TONE[n.href] === 'window'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {badges[n.href]}
          </span>
        )}
      </Link>
    ) : (
      <span
        title="Coming soon"
        className={`block rounded px-3 py-2 text-neutral-400 cursor-default ${indent ? 'ml-4' : ''}`}
      >
        {n.label} <span className="text-xs">· soon</span>
      </span>
    );

  return (
    <nav className="flex flex-col gap-1">
      {top.map((n) => (
        <Item key={n.href} n={n} />
      ))}

      {events.length > 0 && (
        <>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="flex items-center justify-between rounded px-3 py-2 font-semibold text-neutral-700 hover:bg-neutral-200 text-left"
          >
            <span>Events</span>
            <span
              aria-hidden
              className={`text-xs transition-transform ${open ? 'rotate-90' : ''}`}
            >
              ▶
            </span>
          </button>
          {open && events.map((n) => <Item key={n.href} n={n} indent />)}
        </>
      )}

      {rest.map((n) => (
        <Item key={n.href} n={n} />
      ))}

      {/* Said once, here, rather than left as tribal knowledge -- the whole
          point of two colours is lost if nobody knows there are two. */}
      <p className="mt-3 px-3 text-xs leading-relaxed text-neutral-500">
        <span className="inline-block rounded-full bg-amber-100 px-1.5 font-semibold text-amber-800">
          n
        </span>{' '}
        waiting for review ·{' '}
        <span className="inline-block rounded-full bg-blue-100 px-1.5 font-semibold text-blue-800">
          n
        </span>{' '}
        activity in the last 7 days
      </p>
    </nav>
  );
}
