'use client';

// Save-a-copy, done by the browser. Every phone and desktop can print to PDF,
// which means the family gets a file we never had to generate, store, or
// secure -- and the page's own print styles decide what lands on it.

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary !py-2">
      Print / Save as PDF
    </button>
  );
}
