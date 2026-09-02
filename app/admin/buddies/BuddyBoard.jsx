'use client';

// The pairing board: campers who need a buddy on the left, volunteers on the
// right, and one deliberate publish step underneath.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignBuddy, unassignBuddy, setBuddyPublication, setBuddyRequired } from './actions';

function ClearanceBadge({ clearance }) {
  // No record at all is NOT the same as a failed check, and saying "not
  // cleared" for both would be wrong about one of them.
  if (!clearance) {
    return (
      <span
        title="No background check recorded for this volunteer"
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
      >
        no check on file
      </span>
    );
  }
  if (clearance.expired) {
    return (
      <span
        title="Their background check has expired"
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
      >
        check expired
      </span>
    );
  }
  if (!clearance.cleared) {
    return (
      <span
        title={`Background check status: ${clearance.status ?? 'pending'}`}
        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
      >
        check pending
      </span>
    );
  }
  return (
    <span
      title="Background check on file and current"
      className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600"
    >
      cleared
    </span>
  );
}

function SupportNotes({ support }) {
  if (!support) {
    return (
      <p className="mt-1 text-sm text-amber-800">
        No support details on file yet — pairing without them is guesswork.
      </p>
    );
  }
  const bits = [
    ['Communication', support.communication],
    ['Getting around', support.mobility],
    ['Personal care', support.personalCare],
    ['Harder when', support.triggers],
    ['What helps', support.helps],
  ].filter(([, v]) => v);

  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-1">
        {support.seizures && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            seizures
          </span>
        )}
        {support.allergies && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            allergies
          </span>
        )}
      </div>
      {bits.length === 0 ? (
        <p className="text-sm text-neutral-500">No pairing notes recorded.</p>
      ) : (
        <dl className="text-sm">
          {bits.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 font-semibold text-neutral-500">{k}:</dt>
              <dd className="min-w-0 text-neutral-700">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default function BuddyBoard({
  eventId,
  eventName,
  publishedAt,
  campers,
  otherCampers = [],
  canMark = false,
  volunteers,
  assignments,
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [markOpen, setMarkOpen] = useState(false);

  // Marking somebody as needing a buddy. The only way this flag is now set:
  // families stopped being asked on 31 Aug 2026, because the coordinator works
  // it out by talking to them.
  function mark(personId, required, name) {
    if (
      !required &&
      !window.confirm(
        `Record that ${name} does NOT need a one-to-one buddy?

` +
          `Every camper is listed as needing one until somebody decides otherwise, so ` +
          `this is a decision rather than a tidy-up: they come off the board and stop ` +
          `being counted as waiting for a buddy.

` +
          `Any buddy already paired with them stays paired — remove that pairing ` +
          `separately if it is what you meant.`
      )
    ) {
      return;
    }
    start(async () => {
      const res = await setBuddyRequired({ personId, required });
      if (!res?.ok) window.alert(res?.error || 'That could not be saved.');
      else router.refresh();
    });
  }
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(null); // camper participantId

  const byCamper = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (!m.has(a.camperParticipantId)) m.set(a.camperParticipantId, []);
      m.get(a.camperParticipantId).push(a);
    }
    return m;
  }, [assignments]);

  const loadByVolunteer = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      m.set(a.buddyParticipantId, (m.get(a.buddyParticipantId) ?? 0) + 1);
    }
    return m;
  }, [assignments]);

  const volunteerById = useMemo(
    () => new Map(volunteers.map((v) => [v.participantId, v])),
    [volunteers]
  );

  const unpaired = campers.filter((c) => (byCamper.get(c.participantId) ?? []).length === 0);

  function doAssign(camper, volunteer) {
    setError('');
    // A camper who already has a buddy is not necessarily a mistake: some
    // campers genuinely need more than one (25 Aug -- the earlier wording
    // called this "shift pairing", which is a scheduling idea camp does not
    // actually work in, and it made a normal decision sound like a workaround).
    // It still takes an explicit yes, because it is more often a slip.
    const existing = byCamper.get(camper.participantId) ?? [];

    // The same volunteer with the same camper twice is not a judgement call,
    // it is a double entry. Refused outright (25 Aug) -- there is no reading
    // of it that means anything.
    if (existing.some((a) => a.buddyParticipantId === volunteer.participantId)) {
      setError(`${volunteer.name} is already paired with ${camper.name}.`);
      return;
    }

    if (existing.length > 0) {
      const ok = window.confirm(
        `${camper.name} already has a buddy assigned.\n\nAdd ${volunteer.name} as a second buddy?\n\nSome campers do need more than one — say yes if that is the case here. If you meant to swap buddies, remove the first pairing instead.`
      );
      if (!ok) return;
    }

    // One volunteer, two campers. Allowed -- lower-need campers are
    // deliberately paired two to a buddy -- but it has to be deliberate, and
    // until now nothing said it was happening (25 Aug). Naming who else they
    // already have is the whole point: two easy pairings is a plan, an easy
    // one plus a demanding one usually is not.
    const alreadyBuddyFor = campers.filter(
      (c) =>
        c.participantId !== camper.participantId &&
        (byCamper.get(c.participantId) ?? []).some(
          (a) => a.buddyParticipantId === volunteer.participantId
        )
    );
    if (alreadyBuddyFor.length > 0) {
      const ok = window.confirm(
        `${volunteer.name} is already buddy to ${alreadyBuddyFor
          .map((c) => c.name)
          .join(', ')}.\n\nAlso pair them with ${camper.name}?\n\nOne buddy to two campers is fine when both need light support — worth a look at what each of them needs before saying yes.`
      );
      if (!ok) return;
    }
    // The clearance warning fires at the moment of the decision, which is the
    // only moment it can change one.
    const c = volunteer.clearance;
    if (!c || !c.cleared) {
      const why = !c
        ? 'has no background check on file'
        : c.expired
          ? 'has an EXPIRED background check'
          : `has a background check that is not cleared (${c.status ?? 'pending'})`;
      const ok = window.confirm(
        `${volunteer.name} ${why}.\n\nPair them with ${camper.name} anyway?\n\n(Clearances often arrive after pairing is drafted — this is a warning, not a rule. It must not still be true in the week before camp.)`
      );
      if (!ok) return;
    }
    start(async () => {
      const res = await assignBuddy({
        eventId,
        camperParticipantId: camper.participantId,
        buddyParticipantId: volunteer.participantId,
      });
      if (!res.ok) setError(res.error);
      else {
        setPicking(null);
        router.refresh();
      }
    });
  }

  function doUnassign(assignmentId) {
    setError('');
    start(async () => {
      const res = await unassignBuddy({ assignmentId });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function togglePublish() {
    setError('');
    const publishing = !publishedAt;
    const ok = window.confirm(
      publishing
        ? `Publish buddy assignments for ${eventName}?\n\nEvery paired family and volunteer will be able to see who they are with.${
            unpaired.length > 0
              ? `\n\n${unpaired.length} camper${unpaired.length === 1 ? '' : 's'} still ${
                  unpaired.length === 1 ? 'has' : 'have'
                } no buddy.`
              : ''
          }`
        : `Unpublish buddy assignments for ${eventName}?\n\nFamilies who have already seen their buddy will stop being able to.`
    );
    if (!ok) return;
    start(async () => {
      const res = await setBuddyPublication({ eventId, publish: publishing });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* The two numbers staff run the week from, given the size that says so.
          They existed already — as one grey line beside the publish state,
          which is why testing asked "what counter?" (25 Aug). How many still
          need a buddy is the whole job of this page; it should be the first
          thing on it and it should be amber while it is not zero. */}
      <div className="mb-5 flex flex-wrap gap-4">
        <div className="rounded-lg border border-neutral-200 bg-white px-5 py-3">
          <div className="text-3xl font-bold">{campers.length}</div>
          <div className="text-sm font-semibold text-neutral-700">asking for a buddy</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white px-5 py-3">
          <div className="text-3xl font-bold text-green-700">
            {campers.length - unpaired.length}
          </div>
          <div className="text-sm font-semibold text-neutral-700">paired</div>
        </div>
        <div
          className={`rounded-lg border bg-white px-5 py-3 ${
            unpaired.length > 0 ? 'border-amber-300' : 'border-neutral-200'
          }`}
        >
          <div
            className={`text-3xl font-bold ${
              unpaired.length > 0 ? 'text-amber-700' : 'text-neutral-400'
            }`}
          >
            {unpaired.length}
          </div>
          <div className="text-sm font-semibold text-neutral-700">
            {unpaired.length === 0 ? 'nobody left to pair' : 'still without a buddy'}
          </div>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="min-w-0">
          <p className="font-semibold">
            {publishedAt ? (
              <span className="text-green-700">
                Published — families can see their buddy
              </span>
            ) : (
              <span className="text-neutral-700">Draft — families see nothing yet</span>
            )}
          </p>
          <p className="text-sm text-neutral-500">
            {publishedAt && `Published ${publishedAt.slice(0, 10)}`}
          </p>
        </div>
        <button
          onClick={togglePublish}
          disabled={pending}
          className={publishedAt ? 'btn-outline !py-2' : 'btn-primary !py-2'}
        >
          {publishedAt ? 'Unpublish' : 'Publish assignments'}
        </button>
      </div>

      {campers.length === 0 ? (
        <p className="text-neutral-500">
          Nobody on this roster has asked for a one-to-one buddy.
        </p>
      ) : (
        <div className="space-y-4">
          {campers.map((c) => {
            const mine = byCamper.get(c.participantId) ?? [];
            return (
              <div
                key={c.participantId}
                className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold">
                    {c.name}
                    <span className="ml-2 text-sm font-normal text-neutral-500">
                      {c.household}
                    </span>
                  </h3>
                  {mine.length === 0 ? (
                    <span className="flex items-center gap-2">
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                        no buddy assigned
                      </span>
                      {/* Only offered while nobody is paired. Taking someone off
                          the list who already has a buddy would leave a pairing
                          behind with nothing explaining it. */}
                      {canMark && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => mark(c.personId, false, c.name)}
                          className="text-xs text-neutral-500 underline hover:text-neutral-700 disabled:opacity-50"
                        >
                          buddy not needed
                        </button>
                      )}
                    </span>
                  ) : (
                    <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-600">
                      {/* The three states, in the words camp uses (Lawrence, 1 Sep):
                          "buddy assigned — name(s)", "no buddy assigned", "buddy not
                          needed". The name is the point: "who?" is the question
                          staff actually have. */}
                      {mine.length === 1 ? 'buddy assigned' : `${mine.length} buddies assigned`}
                      {' — '}
                      {mine
                        .map((a) => volunteerById.get(a.buddyParticipantId)?.name ?? 'unknown')
                        .join(', ')}
                    </span>
                  )}
                </div>

                {c.buddyRatio && (
                  <p className="mt-0.5 text-sm text-neutral-500">
                    Requested ratio: {c.buddyRatio}
                  </p>
                )}

                <SupportNotes support={c.support} />

                {mine.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {mine.map((a) => {
                      const v = volunteerById.get(a.buddyParticipantId);
                      return (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
                        >
                          <span className="font-semibold">{v?.name ?? 'volunteer'}</span>
                          {v && <ClearanceBadge clearance={v.clearance} />}
                          <button
                            onClick={() => doUnassign(a.id)}
                            disabled={pending}
                            className="ml-auto text-xs font-semibold text-brand underline"
                          >
                            Remove
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="mt-3">
                  {picking === c.participantId ? (
                    <div className="rounded border border-neutral-200 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-semibold">Choose a buddy for {c.name}</p>
                        <button
                          onClick={() => setPicking(null)}
                          className="text-xs text-neutral-500 underline"
                        >
                          Cancel
                        </button>
                      </div>
                      {volunteers.length === 0 ? (
                        <p className="text-sm text-neutral-500">
                          No volunteers on this roster yet.
                        </p>
                      ) : (
                        <ul className="grid gap-1 sm:grid-cols-2">
                          {volunteers.map((v) => {
                            const load = loadByVolunteer.get(v.participantId) ?? 0;
                            return (
                              <li key={v.participantId}>
                                <button
                                  onClick={() => doAssign(c, v)}
                                  disabled={pending}
                                  className="flex w-full flex-wrap items-center gap-2 rounded border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-brand-light disabled:opacity-50"
                                >
                                  <span className="font-medium">{v.name}</span>
                                  <ClearanceBadge clearance={v.clearance} />
                                  {load > 0 && (
                                    <span className="ml-auto text-xs text-neutral-500">
                                      already with {load}
                                    </span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => setPicking(c.participantId)}
                      disabled={pending}
                      className="btn-outline !py-1.5 text-sm"
                    >
                      {mine.length === 0 ? 'Assign a buddy' : 'Add another buddy'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Marking somebody as needing a buddy.
          Families are no longer asked this at registration (31 Aug 2026) — the
          coordinator works it out by talking to them — so this is the only way
          the flag is ever set now. Without it the board would empty itself over
          a season with no way to refill it.

          Collapsed by default: it is a list of every camper at the event, and
          it is a thing you do occasionally, not the job this page is for. */}
      {canMark && otherCampers.length > 0 && (
        <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-5">
          <button
            type="button"
            onClick={() => setMarkOpen((o) => !o)}
            aria-expanded={markOpen}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="font-semibold">Marked as not needing a buddy</span>
              <span className="ml-2 text-sm text-neutral-500">
                {otherCampers.length}{' '}
                {otherCampers.length === 1 ? 'camper' : 'campers'} — put one back on the board
              </span>
            </span>
            <span className="text-sm text-brand underline">
              {markOpen ? 'Hide' : 'Show'}
            </span>
          </button>

          {markOpen && (
            <>
              <p className="mt-2 text-sm text-neutral-600">
                Somebody decided these campers do not need a one-to-one buddy. If that
                has changed — or it was decided too quickly — put them back and they
                return to the board above, ready to pair.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {otherCampers.map((c) => (
                  <button
                    key={c.participantId}
                    type="button"
                    disabled={pending}
                    onClick={() => mark(c.personId, true, c.name)}
                    className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:border-brand hover:bg-brand-light disabled:opacity-50"
                    title={`Mark ${c.name} as needing a one-to-one buddy`}
                  >
                    + {c.name}
                    <span className="ml-1.5 text-xs text-neutral-500">{c.household}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
