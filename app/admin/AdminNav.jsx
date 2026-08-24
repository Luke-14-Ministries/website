'use client';

// The admin sidebar: Overview on top, an expandable "Events" group holding
// everything event-scoped (rosters, check-in, changes, dietary, medical,
// volunteers, activities, buddies, payments), and org-level pages below.
// The group remembers open/closed per browser.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const OPEN_KEY = 'l14_admin_nav_events_open';

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

  const Item = ({ n, indent = false }) =>
    n.ready ? (
      <Link
        href={n.href}
        className={`block rounded px-3 py-2 font-medium hover:bg-neutral-200 ${
          indent ? 'ml-4' : ''
        } ${isActive(n.href) ? 'bg-neutral-200' : ''}`}
      >
        {n.label}
        {(badges[n.href] ?? 0) > 0 && (
          <span
            title={`${badges[n.href]} ${badgeTitles[n.href] ?? 'needing review'}`}
            className="ml-2 inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-semibold"
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
    </nav>
  );
}
