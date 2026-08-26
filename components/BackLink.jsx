import Link from 'next/link';

// The way back, at the top of a page.
//
// Same shape as the floating BackBar that appears once you have scrolled
// (25 Aug: "I like the way you've programmed the sticky/floating pill — let's
// make sure that formatting cascades"). One look for one action: the link at
// the top and the pill that follows you down the page are the same door, and
// they should not read as two different things.
//
// Deliberately NOT a client component. It does nothing but sit there; only the
// floating variant needs to watch the scroll position.

export const BACK_PILL =
  'inline-flex items-center rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-sm font-semibold text-brand shadow-sm hover:bg-neutral-50';

export default function BackLink({
  href = '/account/dashboard/',
  label = 'Back to dashboard',
  className = '',
}) {
  return (
    <Link href={href} className={`${BACK_PILL} ${className}`}>
      ← {label}
    </Link>
  );
}
