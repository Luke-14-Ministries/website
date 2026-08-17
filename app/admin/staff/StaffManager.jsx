'use client';

// The staff editor: change roles, flip the sensitive/giving grants, set titles,
// deactivate, and add new staff by email. Every change goes through the
// admin-only server actions; the staff_write RLS policy is the real gate.
// Deactivating (not deleting) keeps history intact and is reversible.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateStaffMember, addStaffMember } from './actions';

const ROLE_LABEL = { registrar: 'Registrar', coordinator: 'Coordinator', admin: 'Administrator' };

export default function StaffManager({ members, selfId }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('registrar');
  const [adding, setAdding] = useState(false);

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

  const Row = ({ m }) => {
    const isSelf = m.profileId === selfId;
    const busy = busyId === m.profileId;
    return (
      <tr className={`border-t border-neutral-100 align-top ${m.active ? '' : 'opacity-60'}`}>
        <td className="px-4 py-3">
          <span className="font-medium">{m.name}</span>
          {isSelf && <span className="ml-2 text-xs text-neutral-500">(you)</span>}
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
          {m.role === 'admin' ? (
            // Administrators always have giving access -- show it as granted
            // rather than an unchecked-but-locked box, which reads as broken.
            <span
              className="text-xs font-semibold text-neutral-500"
              title="Administrators always have giving access; no separate grant needed."
            >
              always ✓
            </span>
          ) : (
            <input
              type="checkbox"
              checked={m.giving}
              disabled={busy}
              onChange={(e) => patch(m.profileId, { can_view_giving: e.target.checked })}
              className="h-4 w-4"
            />
          )}
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
            <button
              onClick={() => patch(m.profileId, { active: true })}
              disabled={busy}
              className="rounded border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-800"
            >
              {busy ? '…' : 'Reactivate'}
            </button>
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
          They need an account on the site first (created the same way families do). Enter the
          email they signed up with. New staff must set up two-factor before the staff area opens.
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
              onChange={(e) => setAddEmail(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2"
              placeholder="person@example.com"
            />
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
