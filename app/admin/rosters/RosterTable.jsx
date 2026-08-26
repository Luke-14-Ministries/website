'use client';

// The roster browser: filter by event, role, and status; sortable columns
// (newest submissions first by default); CSV and print links that carry the
// active filters so the export matches the screen.

import { useMemo, useState } from 'react';

const ROLE_LABEL = {
  camper: 'Camper',
  parent_guardian: 'Parent/Guardian',
  sibling: 'Sibling',
  caregiver: 'Caregiver',
  volunteer: 'Volunteer',
  childcare: 'Childcare',
  support_team: 'Support team',
};

const STATUS_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted',
  waitlisted: 'Waitlisted',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

const STATUS_CLS = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-amber-100 text-amber-800',
  waitlisted: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-500',
};

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US')}`;

const COLS = [
  { key: 'household', label: 'Household' },
  { key: 'person', label: 'Person' },
  { key: 'sex', label: 'Sex' },
  { key: 'role', label: 'Role' },
  { key: 'tshirt', label: 'T-shirt' },
  { key: 'status', label: 'Status' },
  { key: 'flags', label: 'Flags', noSort: true },
  { key: 'fee', label: 'Fee', right: true },
  { key: 'submitted', label: 'Submitted' },
];

// Sizes in wearing order, not alphabetical -- "Adult 2XL, Adult L, Adult M"
// is useless to someone placing an order.
const TSHIRT_ORDER = [
  'Youth S', 'Youth M', 'Youth L',
  'Adult S', 'Adult M', 'Adult L', 'Adult XL', 'Adult 2XL', 'Adult 3XL',
];

const selectCls = 'rounded border border-neutral-300 px-3 py-1.5 text-sm bg-white';

// Small pill used for the per-person flags column.
function Flag({ tone, children, title }) {
  const cls =
    tone === 'red'
      ? 'bg-red-100 text-red-800'
      : tone === 'amber'
        ? 'bg-amber-100 text-amber-800'
        : tone === 'blue'
          ? 'bg-blue-100 text-blue-800'
          : 'bg-neutral-200 text-neutral-600';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`} title={title}>
      {children}
    </span>
  );
}

export default function RosterTable({ events, rows }) {
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });
  const [fEvent, setFEvent] = useState('');
  const [fRole, setFRole] = useState('');
  const [fStatus, setFStatus] = useState('');

  function clickHeader(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!fEvent || r.eventId === fEvent) &&
          (!fRole || r.role === fRole) &&
          (!fStatus || r.status === fStatus)
      ),
    [rows, fEvent, fRole, fStatus]
  );

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // T-shirts sort by size, not alphabetically: "Adult 2XL, Adult L,
      // Adult M" tells nobody anything. Blanks go last either way.
      if (sort.key === 'tshirt') {
        const rank = (v) => (v ? (TSHIRT_ORDER.indexOf(v) === -1 ? 98 : TSHIRT_ORDER.indexOf(v)) : 99);
        return (rank(a.tshirt) - rank(b.tshirt)) * dir;
      }
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [filtered, sort]);

  const params = new URLSearchParams();
  if (fEvent) params.set('event', fEvent);
  if (fRole) params.set('role', fRole);
  if (fStatus) params.set('status', fStatus);
  const qs = params.toString();
  const csvHref = `/admin/exports/rosters${qs ? `?${qs}` : ''}`;
  const printHref = `/admin/rosters/print${qs ? `?${qs}` : ''}`;

  const families = new Set(filtered.map((r) => r.registrationId)).size;
  const eventName = (id) => events.find((e) => e.id === id)?.name ?? '';

  // T-shirt counts for whatever is filtered on screen -- this is the number
  // someone actually needs when placing the order, and deriving it from the
  // CSV in Excel was the alternative.
  const shirtCounts = useMemo(() => {
    const counts = new Map();
    let missing = 0;
    for (const r of filtered) {
      if (!r.tshirt) {
        missing += 1;
        continue;
      }
      counts.set(r.tshirt, (counts.get(r.tshirt) ?? 0) + 1);
    }
    const ordered = [...counts.entries()].sort((a, b) => {
      const ia = TSHIRT_ORDER.indexOf(a[0]);
      const ib = TSHIRT_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return { ordered, missing, total: filtered.length - missing };
  }, [filtered]);

  // People whose family asked us not to feature them. The list photographers
  // actually need, and the reason this column exists at all.
  const noPhoto = filtered.filter((r) => r.media === false);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={fEvent} onChange={(e) => setFEvent(e.target.value)} className={selectCls}>
          <option value="">All events</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select value={fRole} onChange={(e) => setFRole(e.target.value)} className={selectCls}>
          <option value="">All roles</option>
          {Object.entries(ROLE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>

        <span className="text-sm text-neutral-500">
          {families} {families === 1 ? 'family' : 'families'} · {filtered.length}{' '}
          {filtered.length === 1 ? 'person' : 'people'}
        </span>

        <span className="ml-auto flex gap-3">
          <a href={csvHref} className="btn-outline !py-1.5 text-sm">
            Download CSV
          </a>
          <a href={printHref} className="btn-outline !py-1.5 text-sm">
            Print view
          </a>
        </span>
      </div>

      {/* Two summaries that answer questions staff otherwise ask a spreadsheet:
          what to order, and who not to photograph. Both follow the filters. */}
      {filtered.length > 0 && (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="font-semibold text-sm">T-shirt sizes</p>
            {shirtCounts.ordered.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-500">No sizes recorded yet.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {shirtCounts.ordered.map(([size, n]) => (
                  <span
                    key={size}
                    className="rounded border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-sm"
                  >
                    {/* "× n", because a bare number beside a size read as part
                        of the size ("Youth M 1") in testing. */}
                    {size} <span className="font-bold">× {n}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-neutral-500">
              {shirtCounts.total} of {filtered.length} recorded
              {shirtCounts.missing > 0 && ` · ${shirtCounts.missing} not answered`}
            </p>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className="font-semibold text-sm">Photo permission</p>
            {noPhoto.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-500">
                No one in this list has asked us not to feature them.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm">
                  <span className="font-bold text-red-700">{noPhoto.length}</span>{' '}
                  {noPhoto.length === 1 ? 'person has' : 'people have'} asked not to be featured:
                </p>
                <p className="mt-1 text-sm text-neutral-700">
                  {noPhoto.map((r) => r.person).join(', ')}
                </p>
              </>
            )}
            <p className="mt-2 text-xs text-neutral-500">
              Share this with whoever is photographing. It means not featuring them as the
              subject of a picture — nobody can promise absence from a wide group shot.
            </p>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="text-neutral-500">No one matches these filters.</p>
      ) : (
        <>
        {/* Testing asked, fairly: is sideways scrolling really the right
            answer, or does every staff member need a mouse with a tilt
            wheel? Neither. The roster has more columns than any laptop is
            wide, and the alternatives are worse -- hiding columns behind a
            chooser means the one you need is always hidden, and shrinking
            text to fit makes a check-in table unreadable at arm's length.
            So the table scrolls, the NAME column is pinned so you never
            lose your place, and the hint below names the keyboard gesture
            that works in every browser on every machine. Printing and the
            CSV are the other two ways out, and both are one click away. */}
        <p className="mb-2 text-xs text-neutral-500">
          More columns than fit? Hold <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1">Shift</kbd>{' '}
          and scroll to move sideways — the name column stays put. Print view and the CSV
          both include every column.
        </p>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                {COLS.map((c, ci) => (
                  <th
                    key={c.key}
                    className={`px-4 py-2 font-semibold ${c.right ? 'text-right' : ''} ${
                      ci === 0 ? 'sticky left-0 z-10 bg-neutral-50' : ''
                    }`}
                  >
                    {c.noSort ? (
                      c.label
                    ) : (
                      <button
                        onClick={() => clickHeader(c.key)}
                        className="inline-flex items-center gap-1 hover:text-neutral-800"
                        title="Sort by this column"
                      >
                        {c.label}
                        {sort.key === c.key && <span aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                      </button>
                    )}
                  </th>
                ))}
                {!fEvent && <th className="px-4 py-2 font-semibold">Event</th>}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className="border-t border-neutral-100 align-top">
                  {/* Sticky: the household stays put while the rest scrolls,
                      so a wide roster never loses its row labels (24 Aug). */}
                  <td className="sticky left-0 z-10 bg-white px-4 py-2">
                    <a href={`/admin/registrations/${r.registrationId}`} className="font-medium text-brand underline">
                      {r.household}
                    </a>
                    {r.contact && <div className="text-neutral-500">{r.contact}</div>}
                    {/* The family's note used to sit in the flags column, off
                        to the right past several columns of a table that
                        scrolls sideways — which is why testing reported it
                        missing from the roster while finding it in the CSV
                        (25 Aug). It is now in the sticky column, and it shows
                        its words rather than hiding them in a tooltip: a note
                        a family wrote is the sort of thing that has to be
                        READ, not discovered. */}
                    {r.familyNote && (
                      <div className="mt-1 max-w-[22rem] rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                        <span className="font-semibold">Note from the family:</span>{' '}
                        {r.familyNote}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">{r.person}</td>
                  <td className="px-4 py-2 text-neutral-600">{r.sex || '—'}</td>
                  <td className="px-4 py-2">
                    {/* Volunteers carry a second record — application status
                        and background check — that lives on its own page
                        because it is its own lifecycle, not extra columns
                        here. Volunteers has always linked back to the
                        registration; this is the missing return trip, so the
                        two pages are a pair rather than a one-way street. */}
                    {/* Not linked for a cancelled volunteer: the Volunteers
                        page drops them, so the link would land on a dead
                        anchor — which reads as a broken page rather than as
                        "there is nothing there". */}
                    {r.role === 'volunteer' && r.status !== 'cancelled' ? (
                      <a
                        href={`/admin/volunteers#v-${r.participantId}`}
                        title="Application status and background check"
                        className="text-brand underline"
                      >
                        {ROLE_LABEL[r.role] ?? r.role} ↗
                      </a>
                    ) : (
                      ROLE_LABEL[r.role] ?? r.role
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-neutral-600">
                    {r.tshirt || '—'}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        STATUS_CLS[r.status] ?? STATUS_CLS.submitted
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap gap-1">
                      {r.media === false && (
                        <Flag tone="red" title="This family asked us not to feature them in published photos or video">
                          no photos
                        </Flag>
                      )}
                      {r.directory === false && (
                        <Flag tone="neutral" title="Leave out of the participant directory">
                          not listed
                        </Flag>
                      )}
                      {r.firstTime === true && (
                        <Flag tone="blue" title="First time at a Luke 14 event">
                          1st time
                        </Flag>
                      )}
                      {!r.agreementsSigned && (
                        <Flag tone="amber" title="No signed agreements on file for this registration">
                          unsigned
                        </Flag>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">{money(r.fee)}</td>
                  <td className="px-4 py-2 text-neutral-600">{r.submitted ? r.submitted.slice(0, 10) : '—'}</td>
                  {!fEvent && <td className="px-4 py-2 text-neutral-600">{eventName(r.eventId)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
