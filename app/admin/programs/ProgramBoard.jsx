'use client';

// Placing people into programs, for one event.
//
// The shape of this screen follows one observation: placing is a sorting job,
// not a form-filling job. Somebody sits down with a list of ninety people and
// puts them into six buckets, mostly by age, mostly in runs. So the defaults
// are built for that -- filter to "Not yet placed", tick a run of names, place
// them all at once -- and the per-person dropdown is there for the exceptions
// rather than as the main road.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setParticipantProgram, setManyParticipantPrograms, grantProgramLeader, revokeProgramLeader, setProgramLead } from './actions';

const ROLE_LABEL = {
  camper: 'Camper',
  sibling: 'Sibling',
  parent_guardian: 'Parent / guardian',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

function ageAt(dob, onDate) {
  if (!dob) return null;
  const d = new Date(dob);
  const at = onDate ? new Date(onDate) : new Date();
  if (Number.isNaN(d.getTime()) || Number.isNaN(at.getTime())) return null;
  let age = at.getFullYear() - d.getFullYear();
  const m = at.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export default function ProgramBoard({
  eventId,
  eventName,
  eventStartsOn,
  programs,
  people,
  leaders,
  canGrant,
}) {
  const [filter, setFilter] = useState('unplaced');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkProgram, setBulkProgram] = useState('');
  const [message, setMessage] = useState(null);
  const [pending, startTransition] = useTransition();

  const programById = useMemo(
    () => new Map(programs.map((p) => [p.id, p])),
    [programs]
  );

  const counts = useMemo(() => {
    const c = { unplaced: 0 };
    for (const p of programs) c[p.id] = 0;
    for (const person of people) {
      if (!person.programId) c.unplaced += 1;
      else if (c[person.programId] !== undefined) c[person.programId] += 1;
    }
    return c;
  }, [people, programs]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (filter === 'unplaced' && p.programId) return false;
      if (filter !== 'unplaced' && filter !== 'all' && p.programId !== filter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.preferred ?? '').toLowerCase().includes(q) ||
        p.household.toLowerCase().includes(q)
      );
    });
  }, [people, filter, search]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllShown() {
    setSelected((prev) => {
      const shown = rows.map((r) => r.participantId);
      const allOn = shown.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of shown) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function placeOne(participantId, programId) {
    setMessage(null);
    startTransition(async () => {
      const res = await setParticipantProgram({ participantId, programId: programId || null });
      if (!res.ok) setMessage({ tone: 'bad', text: res.error });
    });
  }

  function placeMany() {
    if (!selected.size) return;
    setMessage(null);
    startTransition(async () => {
      const res = await setManyParticipantPrograms({
        participantIds: [...selected],
        programId: bulkProgram || null,
      });
      if (!res.ok) {
        setMessage({ tone: 'bad', text: res.error });
        return;
      }
      const where = bulkProgram
        ? programById.get(bulkProgram)?.name ?? 'that program'
        : 'no program';
      // Say what actually happened, including the awkward partial case.
      setMessage({
        tone: res.saved === res.requested ? 'good' : 'bad',
        text:
          res.saved === res.requested
            ? `${res.saved} ${res.saved === 1 ? 'person' : 'people'} placed in ${where}.`
            : `Only ${res.saved} of ${res.requested} were saved. Check the rest before you move on.`,
      });
      setSelected(new Set());
    });
  }

  return (
    <div>
      {/* Counts first: the question this page gets opened with is "how many
          are still unplaced?", and the answer should not need a click. */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter('unplaced')}
          className={`rounded-full border px-3 py-1 text-sm ${
            filter === 'unplaced'
              ? 'border-amber-500 bg-amber-50 font-semibold text-amber-900'
              : 'border-neutral-300 hover:bg-neutral-50'
          }`}
        >
          Not yet placed
          <span className="ml-2 rounded-full bg-amber-200 px-2 text-xs text-amber-900">
            {counts.unplaced}
          </span>
        </button>
        {programs.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setFilter(p.id)}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === p.id
                ? 'border-brand bg-brand-light font-semibold text-brand-dark'
                : 'border-neutral-300 hover:bg-neutral-50'
            }`}
          >
            {p.name}
            <span className="ml-2 rounded-full bg-neutral-200 px-2 text-xs">{counts[p.id] ?? 0}</span>
          </button>
        ))}
        {/* E21. The one link Ellen asked for that is genuinely useful: these
            chips filter this page, which is for PLACING people. The Rosters
            page is the full record of the same people — fee, t-shirt, status,
            flags, consent, and the CSV export — and until now there was no way
            to get from one to the other without rebuilding the filter by hand.
            ?program= is read by RosterTable on mount.

            Only shown when a real program is selected: "all" and "not placed"
            have nothing to open — though "not placed" has its own filter in Rosters. */}
        {filter && filter !== 'all' && filter !== 'unplaced' && (
          <a
            href={`/admin/rosters/?program=${filter}`}
            className="rounded-full border border-brand px-3 py-1 text-sm font-semibold text-brand hover:bg-brand-light"
          >
            Open in Rosters &rarr;
          </a>
        )}
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`rounded-full border px-3 py-1 text-sm ${
            filter === 'all'
              ? 'border-brand bg-brand-light font-semibold text-brand-dark'
              : 'border-neutral-300 hover:bg-neutral-50'
          }`}
        >
          Everyone
          <span className="ml-2 rounded-full bg-neutral-200 px-2 text-xs">{people.length}</span>
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a name or family…"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <span className="text-sm text-neutral-500">
          {rows.length} shown · {selected.size} selected
        </span>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-brand/30 bg-brand-light/50 px-3 py-2">
          <span className="text-sm font-medium">
            Place {selected.size} {selected.size === 1 ? 'person' : 'people'} in
          </span>
          <select
            value={bulkProgram}
            onChange={(e) => setBulkProgram(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">— no program —</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={placeMany}
            disabled={pending}
            className="btn-primary px-3 py-1 text-sm"
          >
            {pending ? 'Saving…' : 'Place them'}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm underline"
          >
            Clear selection
          </button>
        </div>
      )}

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

      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  onChange={toggleAllShown}
                  checked={rows.length > 0 && rows.every((r) => selected.has(r.participantId))}
                  aria-label="Select everyone shown"
                />
              </th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Age</th>
              <th className="px-3 py-2 font-semibold">Role</th>
              <th className="px-3 py-2 font-semibold">Family</th>
              <th className="px-3 py-2 font-semibold">Program</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                  {filter === 'unplaced'
                    ? 'Everybody on this roster has been placed.'
                    : 'Nobody matches that.'}
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.participantId} className="border-t border-neutral-100">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(p.participantId)}
                    onChange={() => toggle(p.participantId)}
                    aria-label={`Select ${p.name}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium">{p.name}</span>
                  {p.preferred && p.preferred !== p.name.split(' ')[0] && (
                    <span className="block text-xs text-neutral-500">goes by {p.preferred}</span>
                  )}
                </td>
                <td className="px-3 py-2">{ageAt(p.dob, eventStartsOn) ?? '—'}</td>
                <td className="px-3 py-2">{ROLE_LABEL[p.role] ?? p.role}</td>
                <td className="px-3 py-2 text-neutral-600">{p.household}</td>
                <td className="px-3 py-2">
                  <select
                    value={p.programId ?? ''}
                    onChange={(e) => placeOne(p.participantId, e.target.value)}
                    disabled={pending}
                    className={`rounded border px-2 py-1 text-sm ${
                      p.programId ? 'border-neutral-300' : 'border-amber-400 bg-amber-50'
                    }`}
                  >
                    <option value="">— not placed —</option>
                    {programs.map((prog) => (
                      <option key={prog.id} value={prog.id}>
                        {prog.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <LeaderPanel
        eventId={eventId}
        eventName={eventName}
        programs={programs}
        leaders={leaders}
        canGrant={canGrant}
      />
    </div>
  );
}

// Naming a leader is an ACCESS decision, not a roster edit, so it sits in its
// own panel with its own explanation rather than as another column above.
function LeaderPanel({ eventId, eventName, programs, leaders, canGrant }) {
  // Without this the panel never re-reads its own data. grantProgramLeader
  // calls revalidatePath on the SERVER, which marks the route stale — but
  // nothing asks the client to go and fetch it, so the page keeps rendering the
  // payload it already had. A leader was granted, the green confirmation said
  // so, and all six cards went on saying "No leader named" (reported twice,
  // 31 Aug). The row was in the database the whole time.
  //
  // router.refresh() is the other half of revalidatePath, and it is easy to
  // leave out precisely because the write really did succeed.
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [programId, setProgramId] = useState('');
  const [message, setMessage] = useState(null);
  const [pending, startTransition] = useTransition();

  const byProgram = useMemo(() => {
    const m = new Map();
    for (const l of leaders) {
      if (!m.has(l.programId)) m.set(l.programId, []);
      m.get(l.programId).push(l);
    }
    return m;
  }, [leaders]);

  function grant(e) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const res = await grantProgramLeader({ email, programId, eventId });
      if (!res.ok) setMessage({ tone: 'bad', text: res.error });
      else {
        setMessage({
          tone: res.warning ? 'warn' : 'good',
          text: `${res.name} now leads that program for ${eventName}.${
            res.warning ? ` ${res.warning}` : ''
          }`,
        });
        setEmail('');
        router.refresh();
      }
    });
  }

    function revoke(grantId) {
    setMessage(null);
    startTransition(async () => {
      const res = await revokeProgramLeader({ grantId });
      if (!res.ok) setMessage({ tone: 'bad', text: res.error });
      else router.refresh();
    });
  }

  // One lead per program per event -- a label, not a permission (0071). The
  // server action clears the previous lead first, so this is always "move the
  // badge", never "add a second one".
  function setLead(grantId, isLead) {
    setMessage(null);
    startTransition(async () => {
      const res = await setProgramLead({ grantId, isLead });
      if (!res.ok) setMessage({ tone: 'bad', text: res.error });
      else router.refresh();
    });
  }

  return (
    <section className="mt-8">
      <h3 className="text-lg font-bold mb-1">Program leaders for {eventName}</h3>
      <p className="mb-3 text-sm text-neutral-500">
                A leader signs in and sees one page: the people in their program, with their buddy and a
        flag where there is something to ask about. No medical detail, no other programs, no
        editing. Access is for this event only and ends with it. A program may have more than one
        leader; mark one as the <strong>lead</strong> so check-in staff and drivers know who to
        find — it changes nothing about what either of them can see.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {programs.map((p) => {
          const list = byProgram.get(p.id) ?? [];
          return (
            <div key={p.id} className="rounded border border-neutral-200 bg-white p-3">
              <div className="font-semibold">{p.name}</div>
              {list.length === 0 ? (
                <div className="mt-1 text-sm text-neutral-500">No leader named.</div>
              ) : (
                <ul className="mt-1 space-y-1 text-sm">
                  {list.map((l) => (
                                        <li key={l.id} className="flex items-center justify-between gap-2">
                      <span>
                        {l.name}
                        {l.isLead && (
                          <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand-dark">
                            lead
                          </span>
                        )}
                      </span>
                      {canGrant && (
                        <span className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setLead(l.id, !l.isLead)}
                            disabled={pending}
                            className="text-xs underline text-neutral-500 hover:text-brand-dark"
                            title={
                              l.isLead
                                ? 'Make this person an assistant leader instead.'
                                : 'Make this person the lead. Any current lead becomes an assistant.'
                            }
                          >
                            {l.isLead ? 'make assistant' : 'make lead'}
                          </button>
                          <button
                            type="button"
                            onClick={() => revoke(l.id)}
                            disabled={pending}
                            className="text-xs underline text-neutral-500 hover:text-red-700"
                          >
                            remove
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {canGrant ? (
        <form onSubmit={grant} className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-sm font-medium" htmlFor="leader-email">
              Their email address
            </label>
            <input
              id="leader-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="they must already have an account"
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium" htmlFor="leader-program">
              Program
            </label>
            <select
              id="leader-program"
              required
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">— choose —</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={pending} className="btn-primary px-3 py-1.5 text-sm">
            {pending ? 'Saving…' : 'Name them'}
          </button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-neutral-500">
          Naming a program leader is an administrator’s job — ask one.
        </p>
      )}

      {message && (
        <p
          role="status"
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            message.tone === 'good'
              ? 'border-green-300 bg-green-50 text-green-900'
              : message.tone === 'warn'
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
