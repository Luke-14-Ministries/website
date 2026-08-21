'use client';

// The accounts table: sort by clicking a column, filter with the search box or
// the quick-filter chips, select rows for a batch removal, and use the row
// menu for the one-account actions. All the interactivity lives here; every
// consequence goes through a server action that re-checks admin.

import { useMemo, useState, useTransition } from 'react';
import {
  removeLogins,
  purgeHousehold,
  resetMfa,
  resendVerification,
} from './actions';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unconfirmed', label: 'Unconfirmed email' },
  { key: 'no2fa', label: 'No two-factor' },
  { key: 'staff', label: 'Staff' },
  { key: 'never', label: 'Never signed in' },
];

const dtf = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const fmt = (iso) => (iso ? dtf.format(new Date(iso)) : '—');

export default function AccountsManager({ accounts, selfId, loadError }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [selected, setSelected] = useState(() => new Set());
  const [menuFor, setMenuFor] = useState(null); // user_id of the open row menu
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
        va = `${a.last_name ?? ''} ${a.first_name ?? ''}`.trim().toLowerCase();
        vb = `${b.last_name ?? ''} ${b.first_name ?? ''}`.trim().toLowerCase();
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
      setMenuFor(null);
      setSelected(new Set());
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-t border-neutral-200">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-600">
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
              <Th k="name">Name</Th>
              <Th k="email">Email</Th>
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
              const name =
                [a.first_name, a.last_name].filter(Boolean).join(' ') || '—';
              return (
                <tr key={a.user_id} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.email}`}
                      disabled={isSelf}
                      checked={selected.has(a.user_id)}
                      onChange={() => toggleRow(a.user_id)}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {name}
                    {isSelf && (
                      <span className="ml-1.5 text-xs rounded bg-neutral-200 px-1.5 py-0.5">you</span>
                    )}
                    {a.staff_role && a.staff_active !== false && (
                      <span className="ml-1.5 text-xs rounded bg-blue-100 text-blue-800 px-1.5 py-0.5">
                        {a.staff_role}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.email}
                    {!a.email_confirmed_at && (
                      <span
                        title="Never confirmed their email address"
                        className="ml-1.5 text-xs rounded bg-amber-100 text-amber-800 px-1.5 py-0.5"
                      >
                        unconfirmed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600">{fmt(a.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600">{fmt(a.last_sign_in_at)}</td>
                  <td className="px-3 py-2">
                    {(a.mfa_factor_count ?? 0) > 0 ? (
                      <span className="text-green-700 font-semibold">On</span>
                    ) : (
                      <span className="text-neutral-400">Off</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600">
                    {a.household_name ?? '—'}
                    {(a.household_count ?? 0) > 1 && (
                      <span className="text-xs text-neutral-400"> (+{a.household_count - 1})</span>
                    )}
                  </td>
                  <td className="px-3 py-2 relative text-right">
                    <button
                      type="button"
                      aria-label={`Actions for ${a.email}`}
                      onClick={() => setMenuFor(menuFor === a.user_id ? null : a.user_id)}
                      className="rounded px-2 py-1 hover:bg-neutral-200 font-bold"
                    >
                      ⋯
                    </button>
                    {menuFor === a.user_id && (
                      <div className="absolute right-2 top-9 z-10 w-60 rounded border border-neutral-200 bg-white shadow-lg text-left">
                        {!a.email_confirmed_at && (
                          <MenuItem
                            onClick={() =>
                              run(
                                () => resendVerification(a.email),
                                () => `Confirmation email re-sent to ${a.email}.`
                              )
                            }
                          >
                            Re-send confirmation email
                          </MenuItem>
                        )}
                        {(a.mfa_factor_count ?? 0) > 0 && (
                          <MenuItem
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
                        )}
                        {!isSelf && (
                          <MenuItem onClick={() => setConfirm({ kind: 'remove', rows: [a] })}>
                            Remove login…
                          </MenuItem>
                        )}
                        {!isSelf && a.household_id && (
                          <MenuItem
                            danger
                            onClick={() => setConfirm({ kind: 'purge', row: a, typed: '' })}
                          >
                            Delete family &amp; all their data…
                          </MenuItem>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-neutral-500">
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

function MenuItem({ children, onClick, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left px-4 py-2 text-sm hover:bg-neutral-100 ${
        danger ? 'text-red-700' : 'text-neutral-800'
      }`}
    >
      {children}
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
