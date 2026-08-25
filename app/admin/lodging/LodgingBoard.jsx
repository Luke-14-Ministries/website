'use client';

// The bed board: unplaced people at the top, then every cabin and room with
// who is in it.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignLodging, unassignLodging, setLodgingPublication } from './actions';

const KIND_LABEL = {
  cabin: 'Cabin',
  room: 'Room',
  tent: 'Tent',
  lodge: 'Lodge',
  offsite: 'Off site',
};

const ROLE_SHORT = {
  camper: 'camper',
  parent_guardian: 'parent',
  sibling: 'sibling',
  caregiver: 'caregiver',
  volunteer: 'volunteer',
  childcare: 'childcare',
  support_team: 'support',
};

function PersonChip({ person, onRemove, pending, accessWarning }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-white px-3 py-1.5 text-sm">
      <span className="font-medium">{person.name}</span>
      <span className="text-xs text-neutral-500">{ROLE_SHORT[person.role] ?? person.role}</span>
      {person.gender && <span className="text-xs text-neutral-400">{person.gender}</span>}
      {person.household && (
        <span className="text-xs text-neutral-400" title="Household">
          {person.household}
        </span>
      )}
      {accessWarning && (
        <span
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
          title={`Mobility notes on file: ${person.mobility}. This place is not marked accessible.`}
        >
          check access
        </span>
      )}
      {onRemove && (
        <button
          onClick={onRemove}
          disabled={pending}
          className="ml-auto text-xs font-semibold text-brand underline"
        >
          Remove
        </button>
      )}
    </li>
  );
}

export default function LodgingBoard({
  eventId,
  eventName,
  publishedAt,
  lodgings,
  people,
  assignments,
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [placing, setPlacing] = useState(null); // participantId being placed

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.participantId, p])),
    [people]
  );

  const byLodging = useMemo(() => {
    const m = new Map();
    for (const a of assignments) {
      if (!m.has(a.lodgingId)) m.set(a.lodgingId, []);
      const p = peopleById.get(a.participantId);
      if (p) m.get(a.lodgingId).push(p);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [assignments, peopleById]);

  const placedIds = useMemo(
    () => new Set(assignments.map((a) => a.participantId)),
    [assignments]
  );
  const unplaced = people
    .filter((p) => !placedIds.has(p.participantId))
    .sort((a, b) => a.household.localeCompare(b.household) || a.name.localeCompare(b.name));

  const childrenOf = useMemo(() => {
    const m = new Map();
    for (const l of lodgings) {
      if (!l.parentId) continue;
      if (!m.has(l.parentId)) m.set(l.parentId, []);
      m.get(l.parentId).push(l);
    }
    return m;
  }, [lodgings]);

  const roots = lodgings.filter((l) => !l.parentId);

  // A parent's occupancy includes everyone in its rooms -- how a camp director
  // counts beds, and the only number that answers "is the lodge full?".
  function occupancyOf(lodging) {
    const own = (byLodging.get(lodging.id) ?? []).length;
    const kids = childrenOf.get(lodging.id) ?? [];
    return own + kids.reduce((s, k) => s + occupancyOf(k), 0);
  }

  function needsAccess(person) {
    return Boolean(person.mobility && person.mobility.trim());
  }

  function doAssign(person, lodging) {
    setError('');
    // The access warning is the reason this screen exists rather than a
    // spreadsheet. It fires where it can still change the decision.
    if (needsAccess(person) && !lodging.accessible) {
      const ok = window.confirm(
        `${person.name} has mobility notes on file:\n\n"${person.mobility}"\n\n` +
          `${lodging.name} is NOT marked as accessible.\n\nPlace them here anyway?`
      );
      if (!ok) return;
    }
    const occ = occupancyOf(lodging);
    if (lodging.capacity != null && occ >= lodging.capacity) {
      const ok = window.confirm(
        `${lodging.name} is at capacity (${occ} of ${lodging.capacity}).\n\nAdd ${person.name} anyway?`
      );
      if (!ok) return;
    }
    start(async () => {
      const res = await assignLodging({
        participantId: person.participantId,
        lodgingId: lodging.id,
      });
      if (!res.ok) setError(res.error);
      else {
        setPlacing(null);
        router.refresh();
      }
    });
  }

  function doRemove(participantId) {
    setError('');
    start(async () => {
      const res = await unassignLodging({ participantId });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function togglePublish() {
    setError('');
    const publishing = !publishedAt;
    const ok = window.confirm(
      publishing
        ? `Publish room assignments for ${eventName}?\n\nEvery placed family will be able to see where they are staying.${
            unplaced.length > 0
              ? `\n\n${unplaced.length} ${
                  unplaced.length === 1 ? 'person has' : 'people have'
                } no place yet.`
              : ''
          }`
        : `Unpublish room assignments for ${eventName}?\n\nFamilies will stop being able to see where they are staying.`
    );
    if (!ok) return;
    start(async () => {
      const res = await setLodgingPublication({ eventId, publish: publishing });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function LodgingCard({ lodging, depth = 0 }) {
    const here = byLodging.get(lodging.id) ?? [];
    const kids = childrenOf.get(lodging.id) ?? [];
    const occ = occupancyOf(lodging);
    const over = lodging.capacity != null && occ > lodging.capacity;

    return (
      <div className={depth > 0 ? 'ml-4 border-l-2 border-neutral-100 pl-4' : ''}>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold">
              {lodging.name}
              <span className="ml-2 text-xs font-normal text-neutral-500">
                {KIND_LABEL[lodging.kind] ?? lodging.kind}
              </span>
              {lodging.accessible ? (
                <span
                  className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-700"
                  title={lodging.accessibleNotes || 'Marked accessible'}
                >
                  accessible
                </span>
              ) : (
                <span
                  className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-500"
                  title="Not marked accessible — this may simply mean nobody has checked"
                >
                  not marked accessible
                </span>
              )}
            </h3>
            <span className={`text-sm ${over ? 'font-semibold text-amber-700' : 'text-neutral-500'}`}>
              {lodging.capacity != null ? `${occ} of ${lodging.capacity}` : `${occ} placed`}
              {over ? ' — over' : ''}
            </span>
          </div>

          {lodging.accessibleNotes && (
            <p className="mt-0.5 text-xs text-neutral-500">{lodging.accessibleNotes}</p>
          )}

          {here.length > 0 && (
            <ul className="mt-3 space-y-1">
              {here.map((p) => (
                <PersonChip
                  key={p.participantId}
                  person={p}
                  pending={pending}
                  accessWarning={needsAccess(p) && !lodging.accessible}
                  onRemove={() => doRemove(p.participantId)}
                />
              ))}
            </ul>
          )}

          {placing && (
            <button
              onClick={() => doAssign(peopleById.get(placing), lodging)}
              disabled={pending}
              className="mt-3 btn-outline !py-1 text-xs"
            >
              Place {peopleById.get(placing)?.name} here
            </button>
          )}
        </div>

        {kids.length > 0 && (
          <div className="mt-2 space-y-2">
            {kids.map((k) => (
              <LodgingCard key={k.id} lodging={k} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
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
                Published — families can see where they are staying
              </span>
            ) : (
              <span className="text-neutral-700">Draft — families see nothing yet</span>
            )}
          </p>
          <p className="text-sm text-neutral-500">
            {people.length - unplaced.length} of {people.length} placed · {unplaced.length} to
            go
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

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold">Not yet placed</h3>
          {placing && (
            <button
              onClick={() => setPlacing(null)}
              className="text-xs text-neutral-500 underline"
            >
              Cancel placing
            </button>
          )}
        </div>
        {unplaced.length === 0 ? (
          <p className="mt-2 text-sm text-green-700">Everyone has somewhere to sleep.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-neutral-500">
              Pick someone, then choose their place below. Households are grouped together.
            </p>
            <ul className="mt-3 grid gap-1 sm:grid-cols-2">
              {unplaced.map((p) => (
                <li key={p.participantId}>
                  <button
                    onClick={() => setPlacing(p.participantId)}
                    disabled={pending}
                    className={`flex w-full flex-wrap items-center gap-2 rounded border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                      placing === p.participantId
                        ? 'border-brand bg-brand-light font-semibold'
                        : 'border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-neutral-500">
                      {ROLE_SHORT[p.role] ?? p.role}
                    </span>
                    {p.gender && <span className="text-xs text-neutral-400">{p.gender}</span>}
                    <span className="text-xs text-neutral-400">{p.household}</span>
                    {needsAccess(p) && (
                      <span
                        className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
                        title={p.mobility}
                      >
                        mobility notes
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="space-y-3">
        {roots.map((l) => (
          <LodgingCard key={l.id} lodging={l} />
        ))}
      </div>
    </div>
  );
}
