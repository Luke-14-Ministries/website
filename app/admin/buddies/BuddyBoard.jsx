'use client';

// The pairing board: campers who need a buddy on the left, volunteers on the
// right, and one deliberate publish step underneath.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignBuddy, unassignBuddy, setBuddyPublication } from './actions';

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
  volunteers,
  assignments,
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
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
    // A camper who already has a buddy is not necessarily a mistake -- the
    // schema models time ranges, so shift pairing is possible -- but it is
    // usually an accident, so it takes an explicit yes.
    const existing = byCamper.get(camper.participantId) ?? [];
    if (existing.length > 0) {
      const ok = window.confirm(
        `${camper.name} already has a buddy assigned.\n\nAdd ${volunteer.name} as a SECOND buddy? (Use this only for shift pairing — otherwise remove the first pairing.)`
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
            {campers.length} asking for a buddy · {campers.length - unpaired.length} paired ·{' '}
            {unpaired.length} still to do
            {publishedAt && ` · published ${publishedAt.slice(0, 10)}`}
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
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      needs buddy
                    </span>
                  ) : (
                    <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-600">
                      {mine.length === 1 ? 'buddy assigned' : `${mine.length} buddies`}
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
    </div>
  );
}
