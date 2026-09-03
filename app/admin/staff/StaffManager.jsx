'use client';

// The staff editor: change roles, flip the sensitive/giving grants, set titles,
// deactivate, and add new staff by email. Every change goes through the
// admin-only server actions; the staff_write RLS policy is the real gate.
// Deactivating (not deleting) keeps history intact and is reversible; the
// Deactivated section also offers Remove, which drops the staff row entirely
// for helpers who have moved on (re-addable later; nothing else is touched).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateStaffMember, addStaffMember, removeStaffMember } from './actions';

const ROLE_LABEL = { registrar: 'Registrar', coordinator: 'Coordinator', admin: 'Administrator' };

export default function StaffManager({ members, selfId, accounts = [] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

    const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('registrar');
  const [adding, setAdding] = useState(false);
  // The picker under the email box. Filtering starts at two characters, on
  // email or name, and shows at most eight -- enough to find anyone at this
  // ministry's size without scrolling. Picking fills the box; the form still
  // submits the address, so nothing downstream changed.
  const [pickerOpen, setPickerOpen] = useState(false);
  const needle = addEmail.trim().toLowerCase();
  const matches =
    needle.length >= 2
      ? accounts
          .filter((a) => a.email.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle))
          .slice(0, 8)
      : [];
  const exact = accounts.find((a) => a.email.toLowerCase() === needle) ?? null;

  function patch(profileId, changes) {
    setError('');
    setNotice('');
    setBusyId(profileId);
    start(async () => {
      const res = await updateStaffMember(profileId, changes);
      if (!res.ok) setError(res.error);
      setBusyId(null);
      router.refresh();
    });
  }

  function remove(m) {
    setError('');
    setNotice('');
    setBusyId(m.profileId);
    start(async () => {
      const res = await removeStaffMember(m.profileId);
      if (!res.ok) setError(res.error);
      else setNotice(`${m.name} removed from staff. Their account and records are untouched.`);
      setBusyId(null);
      router.refresh();
    });
  }

  function submitAdd(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setAdding(true);
    start(async () => {
      const res = await addStaffMember(addEmail, addRole);
      if (!res.ok) setError(res.error);
      else {
        setNotice(`${res.name} added to staff.`);
        setAddEmail('');
      }
      setAdding(false);
      router.refresh();
    });
  }

    const activeMembers = members.filter((m) => m.active);
  const inactiveMembers = members.filter((m) => !m.active);
  // Said once at the top, because it is the mistake that actually happens:
  // access is granted to a LOGIN, and a person with two logins has it on one.
  const loginNote = (
    <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <strong>Access belongs to the login, not the person.</strong> The address beside each name is
      the account that has this access. Somebody who signs in with a different address — a second
      email, a personal one — will see no staff area at all, even though they are listed here. If
      that happens, check which address they signed in with before granting anything else.
    </p>
  );

  const Row = ({ m }) => {
    const isSelf = m.profileId === selfId;
    const busy = busyId === m.profileId;
    return (
      <tr className={`border-t border-neutral-100 align-top ${m.active ? '' : 'opacity-60'}`}>
        <td className="px-4 py-3">
                    <span className="font-medium">{m.name}</span>
          {isSelf && <span className="ml-2 text-xs text-neutral-500">(you)</span>}
          {/* The login this access belongs to. Shown on its own line so it can be
              read and compared at a glance -- "which address did you sign in
              with?" is the first question when someone says they have no access. */}
          {m.email ? (
            <div className="text-xs text-neutral-500 break-all" title="The login this access belongs to">
              {m.email}
            </div>
          ) : (
            <div className="text-xs text-amber-700" title="No login found for this profile">
              (login not found)
            </div>
          )}
          <input
            defaultValue={m.title}
            placeholder="Job title, e.g. Camp Director (optional)"
            title="A display-only job title shown alongside their name. Does not affect access."
            disabled={busy}
            onBlur={(e) => {
              if (e.target.value.trim() !== m.title) patch(m.profileId, { title: e.target.value });
            }}
            className="mt-1 block w-full max-w-[14rem] rounded border border-neutral-200 px-2 py-1 text-xs"
          />
        </td>
        <td className="px-4 py-3">
          <div
            className="flex flex-col gap-1"
            title={isSelf && m.role === 'admin' ? 'You cannot remove your own admin role.' : undefined}
          >
            {Object.entries(ROLE_LABEL).map(([v, l]) => (
              <label key={v} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`role-${m.profileId}`}
                  checked={m.role === v}
                  disabled={busy || (isSelf && m.role === 'admin')}
                  onChange={() => patch(m.profileId, { role: v })}
                  className="h-4 w-4"
                />
                {l}
              </label>
            ))}
          </div>
        </td>
        <td className="px-4 py-3 text-center">
          <input
            type="checkbox"
            checked={m.sensitive}
            disabled={busy}
            onChange={(e) => patch(m.profileId, { can_view_sensitive: e.target.checked })}
            className="h-4 w-4"
          />
        </td>
        <td className="px-4 py-3 text-center">
          {/* Editable for every role, admins included (migration 0025): like
              Sensitive, Giving is an explicit grant -- protection for the
              room, not a barrier against the person. */}
          <input
            type="checkbox"
            checked={m.giving}
            disabled={busy}
            onChange={(e) => patch(m.profileId, { can_view_giving: e.target.checked })}
            className="h-4 w-4"
          />
        </td>
        <td className="px-4 py-3 text-center">
          {/* Background checks -- a third explicit grant (migration 0058).
              Separate from Sensitive because knowing somebody was screened, and
              what came back, is a different kind of knowledge from knowing their
              medical needs, and the people who need each are not the same set.
              Every change here is written to staff_access_log with who did it,
              including when that is the same person. */}
          <input
            type="checkbox"
            checked={m.backgroundChecks}
            disabled={busy}
            onChange={(e) =>
              patch(m.profileId, { can_view_background_checks: e.target.checked })
            }
            className="h-4 w-4"
          />
        </td>
        <td className="px-4 py-3 text-right">
          {m.active ? (
            <button
              onClick={() => {
                if (isSelf) return;
                if (window.confirm(`Deactivate ${m.name}? They keep their account but lose all staff access. This is reversible.`)) {
                  patch(m.profileId, { active: false });
                }
              }}
              disabled={busy || isSelf}
              title={isSelf ? 'You cannot deactivate yourself.' : undefined}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700 hover:border-red-400 hover:text-red-700 disabled:opacity-40"
            >
              {busy ? '…' : 'Deactivate'}
            </button>
          ) : (
            <div className="flex flex-col items-end gap-1.5">
              <button
                onClick={() => patch(m.profileId, { active: true })}
                disabled={busy}
                className="rounded border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-800"
              >
                {busy ? '…' : 'Reactivate'}
              </button>
              {/* For someone who has genuinely moved on. Deliberately only
                  offered AFTER deactivation -- two distinct clicks stand
                  between "active admin" and "gone from the list", and the
                  deactivated row is the natural place to decide. */}
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${m.name} from the staff list entirely? Their account and family records are untouched, and they can be re-added later — but their role and access grants here will be forgotten.`
                    )
                  ) {
                    remove(m);
                  }
                }}
                disabled={busy}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-600 hover:border-red-400 hover:text-red-700 disabled:opacity-40"
              >
                {busy ? '…' : 'Remove'}
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const Table = ({ rows }) => (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-semibold">Person</th>
            <th className="px-4 py-2 font-semibold">Role</th>
            <th className="px-4 py-2 font-semibold text-center">Sensitive</th>
            <th className="px-4 py-2 font-semibold text-center">Giving</th>
            <th className="px-4 py-2 font-semibold text-center">Checks</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <Row key={m.profileId} m={m} />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      {error && (
        <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      )}

            {loginNote}

      <Table rows={activeMembers} />

      {inactiveMembers.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold text-neutral-700 mb-2">Deactivated</h3>
          <Table rows={inactiveMembers} />
        </div>
      )}

      <div className="mt-8 rounded-lg bg-white border border-neutral-200 shadow-sm p-6 max-w-lg">
        <h3 className="font-bold mb-1">Add a staff member</h3>
                <p className="text-sm text-neutral-500 mb-3">
          They need an account on the site first (created the same way families do). Start typing
          their name or email and pick the account from the list — that way the grant lands on the
          login they actually use. New staff must set up two-factor before the staff area opens.
        </p>
        <form onSubmit={submitAdd} className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[14rem]">
            <span className="block text-sm font-semibold mb-1">
              Email <span className="text-red-600">*</span>
            </span>
                        <input
              type="email"
              required
              value={addEmail}
              onChange={(e) => {
                setAddEmail(e.target.value);
                setPickerOpen(true);
              }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              autoComplete="off"
              className="w-full rounded border border-neutral-300 px-3 py-2"
              placeholder="start typing a name or email"
              aria-autocomplete="list"
              aria-expanded={pickerOpen && matches.length > 0}
            />
            {pickerOpen && needle.length >= 2 && (
              <ul
                role="listbox"
                className="mt-1 max-h-64 overflow-auto rounded border border-neutral-200 bg-white text-sm shadow-sm"
              >
                {matches.length === 0 ? (
                  <li className="px-3 py-2 text-neutral-500">
                    No account matches. If they have never signed up, they need to create an account
                    first — <span className="whitespace-nowrap">Add to staff</span> will say so.
                  </li>
                ) : (
                  matches.map((a) => (
                    <li key={a.email}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={exact?.email === a.email}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setAddEmail(a.email);
                          setPickerOpen(false);
                        }}
                        className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left hover:bg-neutral-50"
                      >
                        <span>
                          <span className="font-medium">{a.name || '(no name on profile)'}</span>
                          <span className="ml-2 text-neutral-500 break-all">{a.email}</span>
                        </span>
                        {a.onStaff && (
                          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                            already on staff
                          </span>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            {exact && !pickerOpen && (
              <span className="mt-1 block text-xs text-neutral-500">
                {exact.name ? `${exact.name} — ` : ''}
                {exact.onStaff ? 'already on staff; adding again updates their role.' : 'has an account; not on staff yet.'}
              </span>
            )}
          </label>
          <label className="block">
            <span className="block text-sm font-semibold mb-1">Role</span>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="rounded border border-neutral-300 px-3 py-2"
            >
              {Object.entries(ROLE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={adding} className="btn-primary !py-2">
            {adding ? 'Adding…' : 'Add to staff'}
          </button>
        </form>
      </div>
    </div>
  );
}
