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
