'use client';

// The accounts table: sort by clicking a column, filter with the search box or
// the quick-filter chips, select rows for a batch removal, and use the row
// menu for the one-account actions. All the interactivity lives here; every
// consequence goes through a server action that re-checks admin.
//
// Layout notes, learned the hard way on Event Payments and repeated here:
// - The wrapper is overflow-x-auto lg:overflow-visible. Small screens scroll
//   sideways; on desktop the table must FIT, because overflow-visible is what
//   lets the row menu float over the table edge instead of being clipped
//   inside the scroll box (where it also distorts the box's dimensions).
// - Width is won by merging columns, not shrinking text: name + email share
//   one cell, and timestamps show the date with the exact time in the hover
//   tooltip.
// - The row menu is a native <details> element, exactly like Event Payments:
//   the browser owns open/close, so there is no script between the click and
//   the menu appearing. And every action is ALWAYS listed -- the ones that
//   don't apply to a row are disabled with the reason written beside them,
//   because a menu that silently hides items reads as broken.

import { useMemo, useState, useTransition } from 'react';
import {
  removeLogins,
  purgeHousehold,
  resetMfa,
  resendVerification,
  linkLoginToHousehold,
} from './actions';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unconfirmed', label: 'Unconfirmed email' },
  { key: 'no2fa', label: 'No two-factor' },
  { key: 'staff', label: 'Staff' },
  { key: 'never', label: 'Never signed in' },
];

const dateFmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const fullFmt = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
const fmtFull = (iso) => (iso ? fullFmt.format(new Date(iso)) : '');

export default function AccountsManager({ accounts, households = [], selfId, loadError }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [selected, setSelected] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null); // { kind, rows } | { kind: 'purge', row, typed }
  const [notice, setNotice] = useState(null); // { ok, message }
  const [busy, startTransition] = useTransition();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = accounts.filter((a) => {
      if (q) {
        const hay = `${a.email ?? ''} ${a.first_name ?? ''} ${a.last_name ?? ''} ${
          a.household_name ?? ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (filter) {
        case 'unconfirmed':
          return !a.email_confirmed_at;
        case 'no2fa':
          return (a.mfa_factor_count ?? 0) === 0;
        case 'staff':
          return Boolean(a.staff_role) && a.staff_active !== false;
        case 'never':
          return !a.last_sign_in_at;
        default:
          return true;
      }
    });

    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      let va = a[key];
      let vb = b[key];
      if (key === 'name') {
        // Sort the merged Account column by name, falling back to email for
        // rows that never filled in a profile.
        va = (`${a.last_name ?? ''} ${a.first_name ?? ''}`.trim() || a.email || '').toLowerCase();
        vb = (`${b.last_name ?? ''} ${b.first_name ?? ''}`.trim() || b.email || '').toLowerCase();
      }
      if (key === 'mfa_factor_count') {
        va = a.mfa_factor_count ?? 0;
        vb = b.mfa_factor_count ?? 0;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls (never signed in) sink regardless of direction
      if (vb == null) return -1;
      if (va < vb) return -1 * mul;
      if (va > vb) return 1 * mul;
      return 0;
    });
    return out;
  }, [accounts, query, filter, sort]);

  function toggleSort(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  function toggleRow(id) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((s) => {
      const visible = rows.filter((r) => r.user_id !== selfId).map((r) => r.user_id);
      const allIn = visible.every((id) => s.has(id));
      const next = new Set(s);
      visible.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function run(fn, doneMessage) {
    startTransition(async () => {
      const result = await fn();
      setConfirm(null);
      setSelected(new Set());
      // The row menus are native <details> elements, so close any open one
      // the native way once an action lands.
      document
        .querySelectorAll('details[data-row-menu][open]')
        .forEach((d) => d.removeAttribute('open'));
      setNotice(
        result.ok
          ? { ok: true, message: doneMessage(result) }
          : { ok: false, message: result.error }
      );
    });
  }

  const Th = ({ k, children, right }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-3 py-2 font-semibold cursor-pointer select-none whitespace-nowrap hover:text-brand ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
      {sort.key === k && (
        <span className="ml-1 text-xs">{sort.dir === 'asc' ? '▲' : '▼'}</span>
      )}
    </th>
  );

  return (
    <div>
      {loadError && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 text-red-800 px-4 py-3">
          The account list could not be loaded. Refresh the page; if it keeps
          happening, check the server logs for admin_list_accounts.
        </p>
      )}

      {/* Search + quick filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or household…"
          className="rounded border border-neutral-300 px-3 py-2 w-72 max-w-full"
        />
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-sm border ${
                filter === f.key
                  ? 'bg-brand text-white border-brand'
                  : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-sm text-neutral-500">
          {rows.length} of {accounts.length}
        </span>
      </div>

      {/* Batch bar appears only when something is selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 rounded border border-amber-300 bg-amber-50 px-4 py-2.5">
          <span className="text-sm font-semibold text-amber-900">
            {selected.size} selected
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setConfirm({
                kind: 'remove',
                rows: rows.filter((r) => selected.has(r.user_id)),
              })
            }
            className="btn-outline !py-1 text-sm"
          >
            Remove logins…
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-neutral-600 underline"
          >
            Clear
          </button>
        </div>
      )}

      {notice && (
        <p
          className={`mb-4 rounded border px-4 py-3 ${
            notice.ok
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {notice.message}
        </p>
      )}

      <div className="overflow-x-auto lg:overflow-visible rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr className="border-b border-neutral-200">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all visible"
                  checked={
                    rows.length > 0 &&
                    rows.filter((r) => r.user_id !== selfId).every((r) => selected.has(r.user_id))
                  }
                  onChange={toggleAllVisible}
                />
              </th>
              <Th k="name">Account</Th>
              <Th k="created_at">Created</Th>
              <Th k="last_sign_in_at">Last sign-in</Th>
              <Th k="mfa_factor_count">2FA</Th>
              <th className="px-3 py-2 text-left font-semibold">Household</th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const isSelf = a.user_id === selfId;
              const name = [a.first_name, a.last_name].filter(Boolean).join(' ');
              return (
                <tr key={a.user_id} className="border-b border-neutral-100 hover:bg-neutral-50 align-top">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.email}`}
                      disabled={isSelf}
                      checked={selected.has(a.user_id)}
                      onChange={() => toggleRow(a.user_id)}
                    />
                  </td>
                  {/* Name and email share the cell: name (bold) with badges,
                      email in smaller type below. Halves the table width. */}
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-neutral-900">
                      {name || <span className="text-neutral-400">No name</span>}
                      {isSelf && (
                        <span className="ml-1.5 text-xs rounded bg-neutral-200 px-1.5 py-0.5 align-middle">you</span>
                      )}
                      {a.staff_role && a.staff_active !== false && (
                        <span className="ml-1.5 text-xs rounded bg-blue-100 text-blue-800 px-1.5 py-0.5 align-middle">
                          {a.staff_role}
                        </span>
                      )}
                      {!a.email_confirmed_at && (
                        <span
                          title="Never confirmed their email address"
                          className="ml-1.5 text-xs rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 align-middle"
                        >
                          unconfirmed
                        </span>
                      )}
                    </div>
                    <div className="text-neutral-500 break-all">{a.email}</div>
                  </td>
                  <td className="px-3 py-2.5 text-neutral-600" title={fmtFull(a.created_at)}>
                    {fmtDate(a.created_at)}
                  </td>
                  <td className="px-3 py-2.5 text-neutral-600" title={fmtFull(a.last_sign_in_at)}>
                    {fmtDate(a.last_sign_in_at)}
                  </td>
                  <td className="px-3 py-2.5">
                    {(a.mfa_factor_count ?? 0) > 0 ? (
                      <span className="text-green-700 font-semibold">On</span>
                    ) : (
                      <span className="text-neutral-400">Off</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-neutral-600">
                    {a.household_name ?? '—'}
                    {(a.household_count ?? 0) > 1 && (
                      <span className="text-xs text-neutral-400"> (+{a.household_count - 1})</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {/* Same native <details> anchored-overlay as Event
                        Payments -- the browser handles open/close, so there
                        is nothing to go wrong in script. */}
                    <details data-row-menu className="relative inline-block text-left">
                      <summary
                        className="cursor-pointer select-none list-none rounded border border-neutral-300 px-2 py-0.5 font-bold text-neutral-600 hover:border-brand [&::-webkit-details-marker]:hidden"
                        title={`Actions for ${a.email}`}
                      >
                        ⋯
                      </summary>
                      <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg text-left">
                        <MenuItem
                          disabled={Boolean(a.email_confirmed_at)}
                          reason={a.email_confirmed_at ? 'email already confirmed' : null}
                          onClick={() =>
                            run(
                              () => resendVerification(a.email),
                              () => `Confirmation email re-sent to ${a.email}.`
                            )
                          }
                        >
                          Re-send confirmation email
                        </MenuItem>
                        <MenuItem
                          disabled={(a.mfa_factor_count ?? 0) === 0}
                          reason={(a.mfa_factor_count ?? 0) === 0 ? 'no two-factor set up' : null}
                          onClick={() =>
                            run(
                              () => resetMfa(a.user_id),
                              (r) =>
                                `Two-factor reset for ${a.email} — removed ${r.removed} ${
                                  r.removed === 1 ? 'device' : 'devices'
                                }.`
                            )
                          }
                        >
                          Reset two-factor
                        </MenuItem>
                        <MenuItem
                          disabled={(a.household_count ?? 0) > 0}
                          reason={(a.household_count ?? 0) > 0 ? 'already in a household' : null}
                          onClick={() =>
                            setConfirm({ kind: 'link', row: a, householdId: '' })
                          }
                        >
                          Link to household…
                        </MenuItem>
                        <MenuItem
                          disabled={isSelf}
                          reason={isSelf ? 'your own account' : null}
                          onClick={() => setConfirm({ kind: 'remove', rows: [a] })}
                        >
                          Remove login…
                        </MenuItem>
                        <MenuItem
                          danger
                          disabled={isSelf || !a.household_id}
                          reason={
                            isSelf
                              ? 'your own account'
                              : !a.household_id
                                ? 'no household attached'
                                : null
                          }
                          onClick={() => setConfirm({ kind: 'purge', row: a, typed: '' })}
                        >
                          Delete family &amp; all their data…
                        </MenuItem>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-neutral-500">
                  No accounts match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Remove-login confirmation: safe, but say plainly what stays behind. */}
      {confirm?.kind === 'remove' && (
        <Modal onClose={() => setConfirm(null)}>
          <h2 className="text-lg font-bold mb-2">
            Remove {confirm.rows.length === 1 ? 'this login' : `${confirm.rows.length} logins`}?
          </h2>
          <p className="text-sm text-neutral-700 mb-3">
            This deletes the sign-in only. Registrations, payments and family
            records are kept — but nobody will be able to sign in to them until
            the person creates a new account, and a new account will{' '}
            <strong>not</strong> automatically reconnect to the old records.
          </p>
          {confirm.rows.some((r) => (r.registration_count ?? 0) > 0) && (
            <p className="text-sm rounded border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 mb-3">
              {confirm.rows.length === 1
                ? `${confirm.rows[0].email} belongs to a household with ${confirm.rows[0].registration_count} registration${confirm.rows[0].registration_count === 1 ? '' : 's'}.`
                : 'At least one selected account belongs to a household with registrations.'}{' '}
              If the goal is to clear test data completely, use &ldquo;Delete
              family &amp; all their data&rdquo; instead.
            </p>
          )}
          <ul className="text-sm text-neutral-600 mb-4 max-h-32 overflow-y-auto list-disc pl-5">
            {confirm.rows.map((r) => (
              <li key={r.user_id}>{r.email}</li>
            ))}
          </ul>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setConfirm(null)} className="btn-outline !py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () => removeLogins(confirm.rows.map((r) => r.user_id)),
                  (r) => `Removed ${r.removed} ${r.removed === 1 ? 'login' : 'logins'}.`
                )
              }
              className="btn-primary !py-1.5"
            >
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </Modal>
      )}

      {/* Link-to-household: the reverse of remove-login, for reconnecting a
          family AFTER staff have verified who they are on the phone or in
          person. Deliberately manual -- automatic relinking by email address
          would hand the household's records to whoever controls that mailbox
          later, which is not necessarily the same person. */}
      {confirm?.kind === 'link' && (
        <Modal onClose={() => setConfirm(null)}>
          <h2 className="text-lg font-bold mb-2">Link this login to a household</h2>
          <p className="text-sm text-neutral-700 mb-3">
            Connects <strong className="break-words">{confirm.row.email}</strong> to
            an existing family, giving it access to that household&rsquo;s
            registrations, payments and records. Do this only after
            you&rsquo;ve confirmed who you&rsquo;re talking to &mdash; by
            phone or in person, not by email alone.
          </p>
          <label className="block text-sm font-semibold mb-1.5" htmlFor="link-household">
            Household
          </label>
          <select
            id="link-household"
            value={confirm.householdId}
            onChange={(e) => setConfirm({ ...confirm, householdId: e.target.value })}
            className="w-full rounded border border-neutral-300 px-3 py-2 mb-4 bg-white"
          >
            <option value="">Choose a household…</option>
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.display_name}
                {h.city ? ` — ${h.city}` : ''}
              </option>
            ))}
          </select>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setConfirm(null)} className="btn-outline !py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !confirm.householdId}
              onClick={() =>
                run(
                  () => linkLoginToHousehold(confirm.row.user_id, confirm.householdId),
                  (r) =>
                    `Linked ${confirm.row.email} to the household as ${
                      r.role === 'owner' ? 'its owner' : 'an adult member'
                    }.`
                )
              }
              className="btn-primary !py-1.5"
            >
              {busy ? 'Linking…' : 'Link login'}
            </button>
          </div>
        </Modal>
      )}

      {/* Purge confirmation: destructive, so it makes you type. */}
      {confirm?.kind === 'purge' && (
        <Modal onClose={() => setConfirm(null)}>
          <h2 className="text-lg font-bold mb-2 text-red-700">
            Delete {confirm.row.household_name ?? 'this family'} and all their data?
          </h2>
          <p className="text-sm text-neutral-700 mb-3">
            This permanently deletes the household, its people,{' '}
            <strong>{confirm.row.registration_count ?? 0} registration{(confirm.row.registration_count ?? 0) === 1 ? '' : 's'}</strong>,{' '}
            <strong>{confirm.row.payment_count ?? 0} payment record{(confirm.row.payment_count ?? 0) === 1 ? '' : 's'}</strong>, and
            every member&rsquo;s login. There is no undo. Donation records are
            kept, as anonymous entries.
          </p>
          <label className="block text-sm font-semibold mb-1.5">
            Type <span className="font-mono text-red-700">DELETE</span> to confirm
          </label>
          <input
            value={confirm.typed}
            onChange={(e) => setConfirm({ ...confirm, typed: e.target.value })}
            className="w-full rounded border border-neutral-300 px-3 py-2 mb-4 font-mono"
            autoFocus
          />
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setConfirm(null)} className="btn-outline !py-1.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || confirm.typed !== 'DELETE'}
              onClick={() =>
                run(
                  () => purgeHousehold(confirm.row.household_id),
                  () => `Deleted ${confirm.row.household_name ?? 'the household'} and all its data.`
                )
              }
              className="rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-semibold px-4 py-1.5"
            >
              {busy ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger = false, disabled = false, reason = null }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`block w-full text-left px-3 py-1.5 text-sm ${
        disabled
          ? 'text-neutral-400 cursor-default'
          : danger
            ? 'text-red-700 hover:bg-neutral-50'
            : 'text-neutral-800 hover:bg-neutral-50'
      }`}
    >
      {children}
      {disabled && reason && (
        <span className="block text-xs text-neutral-400">{reason}</span>
      )}
    </button>
  );
}

function Modal({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
