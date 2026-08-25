'use client';

// The support-details card, which folds itself away once every attendee has
// been reviewed.
//
// Asked for 25 Aug: a card asking for medical detail should not keep shouting
// after the job is done. But it must not disappear either — families come back
// to change a medication or an emergency contact, and a card that vanished on
// completion would send them hunting for it. So: complete means folded to one
// green line, one click from open.
//
// Anything outstanding keeps it open. The card's whole purpose is the nagging,
// and that has to survive a page load.

import { useState } from 'react';

export default function SupportDetailsCard({ allDone = false, count = 0, children }) {
  const [open, setOpen] = useState(!allDone);

  if (!open) {
    return (
      <div className="mb-8 rounded-lg bg-white border border-neutral-200 shadow-sm px-6 py-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="font-semibold">Support details</span>
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
              All {count} on file ✓
            </span>
          </span>
          <span className="text-sm text-brand underline">Review or update</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-8 rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
      {allDone && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded
            className="text-sm text-neutral-500 underline hover:text-neutral-700"
          >
            Hide — all done
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
