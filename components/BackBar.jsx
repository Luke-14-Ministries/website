'use client';

// A way back that stays on screen.
//
// Asked for 25 Aug: on long scrolling forms the only route back sat at the
// very top, so a family halfway down had to scroll up to leave. The
// registration wizard and the details form solved this with sticky bars that
// also carry a total and a Save button; Manage Household and Activities have
// neither, because both save per-card. They just need the door.
//
// It appears only after some scrolling, so it never covers the header link
// that is already visible at the top of the page.

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function BackBar({ href = '/account/dashboard/', label = 'Back to dashboard' }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 320);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!show) return null;

  return (
    <div className="sticky bottom-4 z-20 flex justify-center print:hidden">
      <Link
        href={href}
        className="rounded-full border border-neutral-300 bg-white/95 px-4 py-2 text-sm font-semibold text-brand shadow-lg backdrop-blur hover:bg-white"
      >
        ← {label}
      </Link>
    </div>
  );
}
