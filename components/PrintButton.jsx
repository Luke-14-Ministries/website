'use client';

// The one Print button. It existed twice, identically, in app/admin/dietary/print
// and app/admin/rosters/print, and E51 was about to make it three. Shared on
// 31 August 2026 rather than copied again.
//
// Trivial today, which is exactly why it drifts: the third copy is where
// somebody adds a "Printing works best in landscape" hint and the other two
// silently do not get it.
export default function PrintButton({ label = 'Print' }) {
  return (
    <button onClick={() => window.print()} className="btn-primary !py-2">
      {label}
    </button>
  );
}
