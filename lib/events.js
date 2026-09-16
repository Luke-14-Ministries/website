// Shared helpers for "which events can someone register for right now?" --
// used by the /register chooser and the family wizard so the two can never
// disagree about what's open.
//
// Two ideas live here:
//
// PROGRAM. The ministry thinks in programs (Camp Celebrate, the Retreat, the
// Party); the database stores each registrable session as its own event row
// ("Camp Celebrate 2027 — Week 1"). The program is the part of the name
// before the " — " separator, so grouping needs no schema change -- but it
// does make that em-dash separator load-bearing in event names. Name new
// events "Program Name — Session" and grouping is automatic; an event with
// no " — " is simply its own program (right for the Retreat or the Party).
//
// OPEN. An event accepts registrations when ALL of these hold:
//   - published (the master switch, admin-set on the Setup page)
//   - it has a published pricing option
//   - registration_opens_at is unset or in the past
//   - registration_closes_at is unset or in the future
// The opens/closes timestamps existed in the schema from day one; the Setup
// page is what finally lets staff set them, and this function is what makes
// every public surface honor them.

export const programOf = (name) => (name ?? '').split(' — ')[0].trim();

export function registrationOpen(event, now = new Date()) {
  if (!event?.published) return false;
  // The ENROLLMENT option, not just any published one: an event that had only
  // the zero-fee volunteer add-on published would otherwise read as open for
  // registration with nothing a family could actually book.
  const opt = enrollmentOption(event);
  if (!opt) return false;
  if (event.registration_opens_at && new Date(event.registration_opens_at) > now) return false;
  if (event.registration_closes_at && new Date(event.registration_closes_at) < now) return false;
  return true;
}

// The columns the chooser and wizard both need; keep the two queries identical.
export const OPEN_EVENT_COLUMNS =
  'id, name, starts_on, ends_on, published, registration_opens_at, registration_closes_at, event_options ( id, fee_cents, published, participant_role )';

// THE option a family registers against: the general enrollment one, which is
// the one carrying the fee.
//
// Both callers used to do `.find((o) => o.published)` and take whatever came
// back first. That was fragile from the day it was written and became a money
// bug the moment 0069 published a SECOND option per event — the zero-fee
// volunteer role. Whichever the array happened to yield first would have set
// the price on the chooser page and the fee written onto every participant, so
// a bad draw registers a whole family at $0.
//
// participant_role IS the distinction: null means "this option does not decide
// the role", which is the general enrollment. Anything else is a role-specific
// add-on and is never what a family is choosing between weeks.
export function enrollmentOption(event) {
  const opts = event?.event_options ?? [];
  return (
    opts.find((o) => o.published && o.participant_role == null) ??
    // Nothing role-neutral: fall back to any published option rather than
    // rendering a week with no price, but never to an unpublished one.
    opts.find((o) => o.published) ??
    null
  );
}

// The zero-fee row used when somebody already registered in another role is
// ALSO volunteering (0069). Null for an event that has not published one.
export function volunteerOption(event) {
  return (event?.event_options ?? []).find(
    (o) => o.published && o.participant_role === 'volunteer'
  ) ?? null;
}

// ---------------------------------------------------------------------------
// THE CLOCK, read in one place.
//
// Every staff page opens on "current" events: ended less than 30 days ago and
// starting within the next twelve months (agreed 25 Aug 2026). Until
// 16 September 2026 eight pages each had their own copy of that arithmetic,
// and components/EventFilter.jsx had a ninth. This is now the only one, so a
// change to either edge happens once and a page's default can never disagree
// with the pill row.
//
// A note on WHY these are functions and not inline Date.now() calls. The
// lint rule react-hooks/purity (eslint-plugin-react-hooks 7) flags a bare
// Date.now() or new Date() inside a component, because in a CLIENT component
// that re-renders, a value that moves between renders produces unstable UI.
// Every caller of these helpers is a SERVER component: it renders once per
// request, and reading the clock at request time is exactly what "today"
// means there. Routing the read through here is not a way round the rule.
// It is the one place the read belongs, and it happens to be a place the
// rule does not look. If a CLIENT component ever needs "now", it should get
// it from props (decided on the server) or from an effect, not from here.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// A calendar date, YYYY-MM-DD in UTC, `days` from now. Negative for the past.
export function dateISO(days = 0, now = Date.now()) {
  return new Date(now + days * DAY_MS).toISOString().slice(0, 10);
}

// A full ISO timestamp `daysAgo` days ago, for comparing against created_at
// and paid_at columns.
export function sinceISO(daysAgo, now = Date.now()) {
  return new Date(now - daysAgo * DAY_MS).toISOString();
}

// The "current events" window: { cutoff, horizon }, both YYYY-MM-DD.
// `horizon` is one CALENDAR year ahead, not 365 days, so a leap day does not
// shift it -- the same arithmetic the pages used before it moved here.
export function eventWindow(now = Date.now()) {
  const horizon = new Date(now);
  horizon.setFullYear(horizon.getFullYear() + 1);
  return {
    cutoff: dateISO(-30, now),
    horizon: horizon.toISOString().slice(0, 10),
  };
}
