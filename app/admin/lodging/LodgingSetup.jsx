'use client';

// Setting up the rooms themselves: buildings, the rooms inside them, RV
// sites, and the off-campus bucket. Added 29 Sep 2026, the day Larry's real
// Carson Springs list arrived (0076). Until then every place on the board
// came from a migration, so renaming "Lodge 111" meant asking the web admin.
//
// This panel is for BEFORE camp; the board above it is for DURING. So it sits
// below the board, behind a "Set up rooms" button, collapsed unless the event
// has no rooms at all -- in which case there is nothing else to look at and
// the first job is obviously this.
//
// Two levels only: a building holds rooms. That is what the camp has and what
// the board draws; the server refuses a room inside a room.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { upsertLodging, retireLodging, restoreLodging, copyLodgingsFrom } from './actions';

// What a top-level place can be, and what a place inside one can be. "Lodge"
// stays for the rows that carry it from 0043; new named blocks whose rooms are
// assigned should be "building", which is what 0076 seeded.
const BUILDING_KINDS = [
  ['building', 'Building (rooms inside are assigned)'],
  ['cabin', 'Cabin (assigned whole)'],
  ['lodge', 'Lodge'],
  ['tent', 'Tent'],
  ['offsite', 'Off site'],
];
const ROOM_KINDS = [
  ['room', 'Room'],
  ['rv', 'RV site'],
];
const KIND_LABEL = {
  building: 'Building',
  cabin: 'Cabin',
  lodge: 'Lodge',
  tent: 'Tent',
  offsite: 'Off site',
  room: 'Room',
  rv: 'RV site',
};

const inputCls = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm';
const labelCls = 'block text-xs font-medium text-neutral-600';

// Plain HTML form, read once on submit. Uncontrolled on purpose: a row that
// is being edited should not re-render the whole tree on every keystroke, and
// the values only matter when Save is pressed.
function readFields(form) {
  const fd = new FormData(form);
  return {
    name: fd.get('name') ?? '',
    kind: fd.get('kind') ?? '',
    capacity: fd.get('capacity') ?? '',
    staffCapacity: fd.get('staffCapacity') ?? '',
    beds: fd.get('beds') ?? '',
    accessible: fd.get('accessible') === 'on',
    accessibleNotes: fd.get('accessibleNotes') ?? '',
    notes: fd.get('notes') ?? '',
  };
}

// The one set of boxes, used for adding and for editing so the two cannot
// drift apart. Hoisted to module level, never defined inside another
// component (CLAUDE.md, working rules) -- an inline definition remounts on
// every render and empties the boxes while somebody is typing in them.
function LodgingForm({ initial, kinds, submitLabel, onSubmit, onCancel, pending }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(readFields(e.currentTarget));
      }}
      className="rounded border border-neutral-300 bg-white p-3"
    >
      <div className="grid gap-2 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className={labelCls}>Name</label>
          <input
            name="name"
            required
            defaultValue={initial?.name ?? ''}
            placeholder={kinds === ROOM_KINDS ? 'Lodge 103' : 'Lodge'}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Kind</label>
          <select name="kind" defaultValue={initial?.kind ?? kinds[0][0]} className={inputCls}>
            {kinds.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            {/* An existing row may carry a kind this level does not offer
                (a top-level "room" from an old seed). Keep it selectable
                rather than silently changing it on the next save. */}
            {initial?.kind && !kinds.some(([v]) => v === initial.kind) && (
              <option value={initial.kind}>{KIND_LABEL[initial.kind] ?? initial.kind}</option>
            )}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Beds (the venue&rsquo;s words)</label>
          <input
            name="beds"
            defaultValue={initial?.beds ?? ''}
            placeholder="2 Double beds"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Capacity</label>
          <input
            name="capacity"
            type="number"
            min="0"
            defaultValue={initial?.capacity ?? ''}
            placeholder="blank = not said"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Staff capacity</label>
          <input
            name="staffCapacity"
            type="number"
            min="0"
            defaultValue={initial?.staffCapacity ?? ''}
            placeholder="optional"
            className={inputCls}
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="accessible" defaultChecked={Boolean(initial?.accessible)} />
            Accessible
          </label>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Access notes</label>
          <input
            name="accessibleNotes"
            defaultValue={initial?.accessibleNotes ?? ''}
            placeholder="Step-free, roll-in shower…"
            className={inputCls}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Notes</label>
          <input
            name="notes"
            defaultValue={initial?.notes ?? ''}
            placeholder="Anything staff should know"
            className={inputCls}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary !px-3 !py-1 text-sm">
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

// One place, as a line: name, kind, the facts, and the two things you can do
// to it. Editing swaps the line for the form in place.
function LodgingLine({ lodging, depth, editing, onEdit, onSave, onCancel, onRetire, pending }) {
  if (editing) {
    return (
      <div className={depth > 0 ? 'ml-6' : ''}>
        <LodgingForm
          initial={lodging}
          kinds={depth > 0 ? ROOM_KINDS : BUILDING_KINDS}
          submitLabel="Save"
          onSubmit={onSave}
          onCancel={onCancel}
          pending={pending}
        />
      </div>
    );
  }
  const facts = [
    lodging.beds,
    lodging.capacity != null ? `sleeps ${lodging.capacity}` : null,
    lodging.staffCapacity != null ? `staff ${lodging.staffCapacity}` : null,
    lodging.accessible ? 'accessible' : null,
  ].filter(Boolean);
  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1 text-sm ${
        depth > 0 ? 'ml-6' : 'font-semibold'
      }`}
    >
      <span>{lodging.name}</span>
      <span className="text-xs font-normal text-neutral-500">
        {KIND_LABEL[lodging.kind] ?? lodging.kind}
      </span>
      {facts.length > 0 && (
        <span className="text-xs font-normal text-neutral-500">{facts.join(' · ')}</span>
      )}
      {lodging.notes && (
        <span className="text-xs font-normal italic text-neutral-400" title={lodging.notes}>
          note
        </span>
      )}
      <span className="ml-auto flex gap-3 text-xs font-normal">
        <button type="button" onClick={onEdit} disabled={pending} className="underline">
          edit
        </button>
        <button
          type="button"
          onClick={onRetire}
          disabled={pending}
          className="text-neutral-500 underline hover:text-red-700"
        >
          retire
        </button>
      </span>
    </div>
  );
}

export default function LodgingSetup({ eventId, eventName, lodgings, otherEvents, defaultOpen }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [message, setMessage] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [addingUnder, setAddingUnder] = useState(null); // parent id, or 'root'
  const [showInactive, setShowInactive] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [pending, startTransition] = useTransition();

  const active = useMemo(() => lodgings.filter((l) => l.active), [lodgings]);
  const inactive = useMemo(() => lodgings.filter((l) => !l.active), [lodgings]);
  const byId = useMemo(() => new Map(lodgings.map((l) => [l.id, l])), [lodgings]);
  const roots = useMemo(() => active.filter((l) => !l.parentId), [active]);
  const childrenOf = useMemo(() => {
    const m = new Map();
    for (const l of active) {
      if (!l.parentId) continue;
      if (!m.has(l.parentId)) m.set(l.parentId, []);
      m.get(l.parentId).push(l);
    }
    return m;
  }, [active]);

  // router.refresh() after every write: revalidatePath marks the route stale
  // on the server, and this is the half that makes the page go and fetch it
  // (the ProgramBoard lesson, 31 Aug).
  function run(action, onDone) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setMessage({ tone: 'bad', text: res.error });
        router.refresh();
        return;
      }
      if (onDone) onDone(res);
      router.refresh();
    });
  }

  function add(parentId, fields) {
    run(
      () => upsertLodging({ eventId, parentId: parentId === 'root' ? null : parentId, ...fields }),
      () => {
        setAddingUnder(null);
        setMessage({ tone: 'good', text: `${fields.name} added.` });
      }
    );
  }

  function save(id, fields) {
    run(
      () => upsertLodging({ id, eventId, ...fields }),
      () => setEditingId(null)
    );
  }

  // The confirm says what retiring does and does not do. The server refuses
  // if anyone is still placed there, and says how many -- so the confirm does
  // not need to threaten that people will drop off the board, because they
  // never will.
  function retire(lodging) {
    const kids = childrenOf.get(lodging.id) ?? [];
    const ok = window.confirm(
      `Retire ${lodging.name}${
        kids.length > 0 ? ` and the ${kids.length} ${kids.length === 1 ? 'room' : 'rooms'} in it` : ''
      }?\n\nIt comes off the board but nothing is deleted — you can bring it back from the retired list. If anyone is still placed there, this will refuse and tell you how many.`
    );
    if (!ok) return;
    run(
      () => retireLodging({ id: lodging.id }),
      () => setMessage({ tone: 'good', text: `${lodging.name} retired.` })
    );
  }

  function restore(lodging) {
    run(
      () => restoreLodging({ id: lodging.id }),
      () => setMessage({ tone: 'good', text: `${lodging.name} is back on the board.` })
    );
  }

  function copy() {
    if (!copyFrom) return;
    const from = otherEvents.find((e) => e.id === copyFrom);
    const ok = window.confirm(
      `Copy every active room and building from ${from?.name ?? 'that event'} into ${eventName}?\n\nOnly the places come across — nobody's assignment does.`
    );
    if (!ok) return;
    run(
      () => copyLodgingsFrom({ fromEventId: copyFrom, toEventId: eventId }),
      (res) =>
        setMessage({
          tone: 'good',
          text: `${res.copied} ${res.copied === 1 ? 'place' : 'places'} copied from ${
            from?.name ?? 'the other event'
          }.`,
        })
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="font-semibold">
          Set up rooms
          <span className="ml-2 text-xs font-normal text-neutral-500">
            {active.length === 0
              ? 'nothing set up yet'
              : `${roots.length} ${roots.length === 1 ? 'building' : 'buildings'}, ${
                  active.length - roots.length
                } rooms`}
          </span>
        </span>
        <span className="text-sm text-brand">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="border-t border-neutral-200 px-4 py-4">
          <p className="mb-3 text-sm text-neutral-500">
            Buildings hold rooms; a family is placed in a room, a cabin can be assigned whole.
            Retiring hides a place from the board without deleting it. Capacity is advisory
            &mdash; the board warns, it never refuses.
          </p>

          {message && (
            <p
              role="status"
              className={`mb-3 rounded border px-3 py-2 text-sm ${
                message.tone === 'good'
                  ? 'border-green-300 bg-green-50 text-green-900'
                  : 'border-red-300 bg-red-50 text-red-800'
              }`}
            >
              {message.text}
            </p>
          )}

          {/* Adding a building sits at the top, where CampSite put "+ Add a
              new room…", so the first thing a coordinator sees on an empty
              event is the way in. */}
          <div className="mb-4">
            {addingUnder === 'root' ? (
              <LodgingForm
                kinds={BUILDING_KINDS}
                submitLabel="Add building / place"
                onSubmit={(fields) => add('root', fields)}
                onCancel={() => setAddingUnder(null)}
                pending={pending}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setAddingUnder('root');
                }}
                disabled={pending}
                className="btn-outline !px-3 !py-1 text-sm"
              >
                + Add a building / place
              </button>
            )}
          </div>

          {/* Copying only works INTO an empty event; the server refuses
              otherwise, so the control is only offered when it can succeed.
              The same venue two weeks running is the common case, and typing
              sixty rooms twice is how the second week ends up with a typo the
              first does not have. */}
          {otherEvents.length > 0 &&
            (active.length === 0 ? (
              <div className="mb-4 flex flex-wrap items-end gap-2 rounded border border-brand/30 bg-brand-light/50 px-3 py-2">
                <div>
                  <label className={labelCls} htmlFor="copy-from">
                    Copy rooms from another event&hellip;
                  </label>
                  <select
                    id="copy-from"
                    value={copyFrom}
                    onChange={(e) => setCopyFrom(e.target.value)}
                    className="rounded border border-neutral-300 px-2 py-1 text-sm"
                  >
                    <option value="">— choose an event —</option>
                    {otherEvents.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                        {e.startsOn ? ` (${e.startsOn})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={copy}
                  disabled={pending || !copyFrom}
                  className="btn-primary !px-3 !py-1 text-sm disabled:opacity-50"
                >
                  {pending ? 'Copying…' : 'Copy them here'}
                </button>
              </div>
            ) : (
              <p className="mb-4 text-xs text-neutral-500">
                To copy the rooms from another event instead, retire everything here first
                &mdash; copying only works into an empty event.
              </p>
            ))}

          <div className="space-y-3">
            {roots.map((root) => {
              const kids = childrenOf.get(root.id) ?? [];
              return (
                <div key={root.id} className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
                  <LodgingLine
                    lodging={root}
                    depth={0}
                    editing={editingId === root.id}
                    onEdit={() => {
                      setAddingUnder(null);
                      setEditingId(root.id);
                    }}
                    onSave={(fields) => save(root.id, fields)}
                    onCancel={() => setEditingId(null)}
                    onRetire={() => retire(root)}
                    pending={pending}
                  />
                  {kids.map((k) => (
                    <LodgingLine
                      key={k.id}
                      lodging={k}
                      depth={1}
                      editing={editingId === k.id}
                      onEdit={() => {
                        setAddingUnder(null);
                        setEditingId(k.id);
                      }}
                      onSave={(fields) => save(k.id, fields)}
                      onCancel={() => setEditingId(null)}
                      onRetire={() => retire(k)}
                      pending={pending}
                    />
                  ))}
                  {addingUnder === root.id ? (
                    <div className="ml-6 mt-2">
                      <LodgingForm
                        kinds={ROOM_KINDS}
                        submitLabel={`Add to ${root.name}`}
                        onSubmit={(fields) => add(root.id, fields)}
                        onCancel={() => setAddingUnder(null)}
                        pending={pending}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setAddingUnder(root.id);
                      }}
                      disabled={pending}
                      className="ml-6 mt-1 text-xs font-semibold text-brand underline"
                    >
                      + Add a room to {root.name}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Retired places, folded away. Here so a mistake is one click to
              undo, and so the 0076 placeholders ("Cabin 1", "Main Lodge") stay
              visible as what they are rather than vanishing without trace. */}
          {inactive.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowInactive((s) => !s)}
                className="text-xs text-neutral-500 underline"
              >
                {showInactive ? 'Hide' : 'Show'} {inactive.length} retired{' '}
                {inactive.length === 1 ? 'place' : 'places'}
              </button>
              {showInactive && (
                <ul className="mt-2 space-y-1">
                  {inactive.map((l) => {
                    const parent = l.parentId ? byId.get(l.parentId) : null;
                    return (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-baseline gap-x-3 text-sm text-neutral-500"
                      >
                        <span>
                          {parent ? `${parent.name} › ` : ''}
                          {l.name}
                        </span>
                        <span className="text-xs">{KIND_LABEL[l.kind] ?? l.kind}</span>
                        <button
                          type="button"
                          onClick={() => restore(l)}
                          disabled={pending}
                          className="text-xs font-semibold text-brand underline"
                        >
                          bring back
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
