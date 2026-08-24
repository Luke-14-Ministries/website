'use client';

// The one save button, used by every form that saves in place.
//
// The lifecycle, decided from testing feedback (24 Aug): the button itself
// carries the state -- Save -> Saving... -> Saved -- and "Saved" STAYS on the
// button until something changes, at which point it flips back to Save. A
// green "Saved" that pops in beside the button and quietly disappears made a
// tester wonder whether it had really saved; the button saying so, and staying
// said, doesn't.
//
// The parent owns the state (it knows when its fields change); this component
// just renders it consistently:
//   busy   -> "Saving..." and disabled
//   saved  -> "Saved ✓" (still clickable -- a redundant save is harmless)
//   else   -> the label ("Save" unless overridden)

export default function SaveButton({
  busy = false,
  saved = false,
  onClick,
  disabled = false,
  label = 'Save',
  className = '',
  // 'submit' for forms that save via onSubmit (household manager);
  // 'button' + onClick everywhere else.
  type = 'button',
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className={`btn-primary disabled:opacity-50 ${className}`}
    >
      {busy ? 'Saving…' : saved ? 'Saved ✓' : label}
    </button>
  );
}
