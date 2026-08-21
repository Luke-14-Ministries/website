// Shared helpers for "which events can someone register for right now?" --
// used by the /register chooser and the family wizard so the two can never
// disagree about what's open.
//
// Two ideas live here:
//
// PROGRAM. The ministry thinks in programs (Camp Celebrate, the Retreat, the
// Party); the database stores each registrable session as its own event row
// ("Camp Celebrate 2026 — Week 1"). The program is the part of the name
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
  const opt = (event.event_options ?? []).find((o) => o.published);
  if (!opt) return false;
  if (event.registration_opens_at && new Date(event.registration_opens_at) > now) return false;
  if (event.registration_closes_at && new Date(event.registration_closes_at) < now) return false;
  return true;
}

// The columns the chooser and wizard both need; keep the two queries identical.
export const OPEN_EVENT_COLUMNS =
  'id, name, starts_on, ends_on, published, registration_opens_at, registration_closes_at, event_options ( id, fee_cents, published )';
