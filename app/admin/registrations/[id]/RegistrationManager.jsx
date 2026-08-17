'use client';

// The interactive half of the registration-management screen. The page
// (page.jsx) is a server component that reads the data under row-level
// security; this component renders it and calls the server actions to change
// it. Every write goes through those actions, so RLS still governs what a
// staff member can actually do -- this file only decides how it looks.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  setParticipantStatus,
  updatePerson,
  updateHousehold,
  addParticipant,
  deleteParticipantPermanently,
  setAdjustments,
} from './actions';

const STATUS_OPTIONS = [
  ['draft', 'Draft'],
  ['submitted', 'Submitted — pending review'],
  ['waitlisted', 'Waitlisted'],
  ['confirmed', 'Confirmed'],
  ['cancelled', 'Cancelled'],
];

const STATUS_CLS = {
  draft: 'bg-neutral-100 text-neutral-700',
  submitted: 'bg-amber-100 text-amber-800',
  waitlisted: 'bg-orange-100 text-orange-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-neutral-200 text-neutral-500',
};

const ROLE_OPTIONS = [
  ['camper', 'Camper'],
  ['parent_guardian', 'Parent/Guardian'],
  ['sibling', 'Sibling'],
  ['caregiver', 'Caregiver'],
  ['volunteer', 'Volunteer'],
  ['childcare', 'Childcare'],
  ['support_team', 'Support team'],
];
const ROLE_LABEL = Object.fromEntries(ROLE_OPTIONS);

const money = (c) => `$${((c ?? 0) / 100).toLocaleString('en-US')}`;

const inputCls =
  'w-full rounded border border-neutral-300 px-3 py-1.5 text-sm';
const labelCls = 'block text-xs font-semibold text-neutral-500 mb-1';

// A tiny inline banner used by every sub-form to show a save error.
function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

// --- the per-participant status control (#14) --------------------------------
function StatusControl({ registrationId, participant }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  function change(e) {
    const next = e.target.value;
    setError('');
    start(async () => {
      const res = await setParticipantStatus(registrationId, participant.id, next);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            STATUS_CLS[participant.status] ?? STATUS_CLS.submitted
          }`}
        >
          {participant.status}
        </span>
        <select
          value={participant.status}
          onChange={change}
          disabled={pending}
          aria-label="Change status"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          {STATUS_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {pending && <span className="text-xs text-neutral-400">saving…</span>}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

// --- edit one camper's details (#15) -----------------------------------------
function PersonEditor({ registrationId, person, onDone }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    first_name: person.first_name ?? '',
    last_name: person.last_name ?? '',
    preferred_name: person.preferred_name ?? '',
    date_of_birth: person.date_of_birth ?? '',
    gender: person.gender ?? '',
    pronouns: person.pronouns ?? '',
    email: person.email ?? '',
    phone: person.phone ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function save() {
    setError('');
    start(async () => {
      const res = await updatePerson(registrationId, person.id, f);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>First name <span className="text-red-600">*</span></label>
          <input className={inputCls} value={f.first_name} onChange={set('first_name')} />
        </div>
        <div>
          <label className={labelCls}>Last name <span className="text-red-600">*</span></label>
          <input className={inputCls} value={f.last_name} onChange={set('last_name')} />
        </div>
        <div>
          <label className={labelCls}>Preferred name</label>
          <input className={inputCls} value={f.preferred_name} onChange={set('preferred_name')} />
        </div>
        <div>
          <label className={labelCls}>Date of birth</label>
          <input type="date" className={inputCls} value={f.date_of_birth} onChange={set('date_of_birth')} />
        </div>
        <div>
          <label className={labelCls}>Gender</label>
          <input className={inputCls} value={f.gender} onChange={set('gender')} />
        </div>
        <div>
          <label className={labelCls}>Pronouns</label>
          <input className={inputCls} value={f.pronouns} onChange={set('pronouns')} />
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input className={inputCls} value={f.email} onChange={set('email')} />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input className={inputCls} value={f.phone} onChange={set('phone')} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={pending} className="btn-primary !py-1.5 text-sm">
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onDone} disabled={pending} className="btn-outline !py-1.5 text-sm">
          Cancel
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        Medical and support details are edited on the Medical &amp; Support screen, which is a
        separate permission.
      </p>
    </div>
  );
}

// --- scholarship / discount editor -------------------------------------------
function AdjustmentsEditor({ registrationId, participant, onDone }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    scholarship: ((participant.scholarship_cents ?? 0) / 100).toFixed(2),
    discount: ((participant.discount_cents ?? 0) / 100).toFixed(2),
    note: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function save() {
    setError('');
    start(async () => {
      const res = await setAdjustments(registrationId, participant.id, f);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <h4 className="font-semibold mb-1 text-sm">Scholarship &amp; discount</h4>
      <p className="text-xs text-neutral-500 mb-3">
        Reduces what this person owes. Flows into the family&rsquo;s balance, their dashboard,
        and the printable statement automatically. Fee: {money(participant.fee_cents)}.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Scholarship ($)</label>
          <input className={inputCls} inputMode="decimal" value={f.scholarship} onChange={set('scholarship')} />
        </div>
        <div>
          <label className={labelCls}>Discount ($)</label>
          <input className={inputCls} inputMode="decimal" value={f.discount} onChange={set('discount')} />
        </div>
        <div className="sm:col-span-3">
          <label className={labelCls}>Note (kept with the scholarship record)</label>
          <input className={inputCls} value={f.note} onChange={set('note')} placeholder="e.g. Board-approved hardship scholarship" />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={pending} className="btn-primary !py-1.5 text-sm">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onDone} disabled={pending} className="btn-outline !py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- one participant row ------------------------------------------------------
function ParticipantRow({ registrationId, participant }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const p = participant.person ?? {};
  const isCancelled = participant.status === 'cancelled';

  function run(fn) {
    setError('');
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  // Everyday "remove" is reversible: it just sets the status to cancelled, which
  // you can undo with Restore. Nothing leaves the database.
  function cancel() {
    if (
      !confirm(
        `Remove ${p.first_name} ${p.last_name} from this week?\n\nThis is reversible — they move to "cancelled" and you can Restore them at any time. Nothing is deleted.`
      )
    )
      return;
    run(() => setParticipantStatus(registrationId, participant.id, 'cancelled'));
  }
  function restore() {
    run(() => setParticipantStatus(registrationId, participant.id, 'submitted'));
  }
  // Only offered on an already-cancelled row, and it says plainly that it cannot
  // be undone.
  function hardDelete() {
    if (
      !confirm(
        `Permanently delete ${p.first_name} ${p.last_name} from this registration?\n\nThis CANNOT be undone. Their household record stays; only this week's entry is removed.`
      )
    )
      return;
    run(() => deleteParticipantPermanently(registrationId, participant.id));
  }

  return (
    <div className="border-t border-neutral-100 py-4 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {p.first_name} {p.last_name}
            {p.preferred_name ? (
              <span className="font-normal text-neutral-500"> ("{p.preferred_name}")</span>
            ) : null}
          </p>
          <p className="text-sm text-neutral-500">
            {ROLE_LABEL[participant.camp_role] ?? participant.camp_role} · {money(participant.fee_cents)}
            {(participant.scholarship_cents ?? 0) > 0 && (
              <span className="text-green-700"> − {money(participant.scholarship_cents)} scholarship</span>
            )}
            {(participant.discount_cents ?? 0) > 0 && (
              <span className="text-green-700"> − {money(participant.discount_cents)} discount</span>
            )}
            {p.date_of_birth ? ` · b. ${p.date_of_birth}` : ' · no DOB on file'}
          </p>
        </div>
        <StatusControl registrationId={registrationId} participant={participant} />
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <button onClick={() => setEditing((v) => !v)} className="text-brand underline">
          {editing ? 'Close' : 'Edit details'}
        </button>
        <button onClick={() => setAdjusting((v) => !v)} className="text-brand underline">
          {adjusting ? 'Close adjustments' : 'Scholarship / discount'}
        </button>
        {isCancelled ? (
          <>
            <button onClick={restore} disabled={pending} className="text-brand underline">
              {pending ? 'Working…' : 'Restore'}
            </button>
            <button onClick={hardDelete} disabled={pending} className="text-red-700 underline">
              {pending ? 'Working…' : 'Permanently delete'}
            </button>
          </>
        ) : (
          <button onClick={cancel} disabled={pending} className="text-red-700 underline">
            {pending ? 'Working…' : 'Cancel (remove from week)'}
          </button>
        )}
      </div>
      <ErrorNote>{error}</ErrorNote>

      {editing && (
        <PersonEditor
          registrationId={registrationId}
          person={{ id: participant.person?.id, ...p }}
          onDone={() => setEditing(false)}
        />
      )}
      {adjusting && (
        <AdjustmentsEditor
          registrationId={registrationId}
          participant={participant}
          onDone={() => setAdjusting(false)}
        />
      )}
    </div>
  );
}

// --- add a person by hand (#15) ----------------------------------------------
function AddPerson({ registrationId, options }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    camp_role: 'camper',
    event_option_id: options[0]?.id ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function add() {
    setError('');
    start(async () => {
      const res = await addParticipant(registrationId, f);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        setF({
          first_name: '',
          last_name: '',
          date_of_birth: '',
          camp_role: 'camper',
          event_option_id: options[0]?.id ?? '',
        });
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline !py-2 text-sm mt-4">
        + Add a person to this week
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <h4 className="font-semibold mb-3">Add a person</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>First name <span className="text-red-600">*</span></label>
          <input className={inputCls} value={f.first_name} onChange={set('first_name')} />
        </div>
        <div>
          <label className={labelCls}>Last name <span className="text-red-600">*</span></label>
          <input className={inputCls} value={f.last_name} onChange={set('last_name')} />
        </div>
        <div>
          <label className={labelCls}>Date of birth</label>
          <input type="date" className={inputCls} value={f.date_of_birth} onChange={set('date_of_birth')} />
        </div>
        <div>
          <label className={labelCls}>Role</label>
          <select className={inputCls} value={f.camp_role} onChange={set('camp_role')}>
            {ROLE_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Camp option (sets the fee) <span className="text-red-600">*</span></label>
          <select className={inputCls} value={f.event_option_id} onChange={set('event_option_id')}>
            {options.length === 0 && <option value="">No options published</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — {money(o.fee_cents)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3 flex gap-2">
        <button onClick={add} disabled={pending} className="btn-primary !py-1.5 text-sm">
          {pending ? 'Adding…' : 'Add person'}
        </button>
        <button onClick={() => setOpen(false)} disabled={pending} className="btn-outline !py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- edit the household's contact details (#15) ------------------------------
function HouseholdEditor({ registrationId, household }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({
    display_name: household.display_name ?? '',
    email: household.email ?? '',
    phone: household.phone ?? '',
    address_line1: household.address_line1 ?? '',
    address_line2: household.address_line2 ?? '',
    city: household.city ?? '',
    state: household.state ?? '',
    postal_code: household.postal_code ?? '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function save() {
    // A soft check, not a hard stop: staff sometimes genuinely don't have a
    // phone or email yet, so we ask rather than block. (Hard-required fields
    // like a person's name are enforced separately, on the server.)
    const missing = [];
    if (!f.phone.trim()) missing.push('phone number');
    if (!f.email.trim()) missing.push('email');
    if (
      missing.length &&
      !confirm(`This family has no ${missing.join(' and no ')} on file. Save anyway?`)
    )
      return;

    setError('');
    start(async () => {
      const res = await updateHousehold(registrationId, household.id, f);
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        setEditing(false);
      }
    });
  }

  if (!editing) {
    return (
      <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{household.display_name}</h2>
            <p className="text-sm text-neutral-600">
              {household.email || 'no email'}
              {household.phone ? ` · ${household.phone}` : ''}
            </p>
            {(household.address_line1 || household.city) && (
              <p className="text-sm text-neutral-500 mt-1">
                {[household.address_line1, household.address_line2, household.city, household.state, household.postal_code]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            )}
          </div>
          <button onClick={() => setEditing(true)} className="text-brand underline text-sm">
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
      <h2 className="text-lg font-bold mb-3">Edit household</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>Household name</label>
          <input className={inputCls} value={f.display_name} onChange={set('display_name')} />
        </div>
        <div>
          <label className={labelCls}>Email</label>
          <input className={inputCls} value={f.email} onChange={set('email')} />
        </div>
        <div>
          <label className={labelCls}>Phone</label>
          <input className={inputCls} value={f.phone} onChange={set('phone')} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Address line 1</label>
          <input className={inputCls} value={f.address_line1} onChange={set('address_line1')} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Address line 2</label>
          <input className={inputCls} value={f.address_line2} onChange={set('address_line2')} />
        </div>
        <div>
          <label className={labelCls}>City</label>
          <input className={inputCls} value={f.city} onChange={set('city')} />
        </div>
        <div>
          <label className={labelCls}>State</label>
          <input className={inputCls} value={f.state} onChange={set('state')} />
        </div>
        <div>
          <label className={labelCls}>Postal code</label>
          <input className={inputCls} value={f.postal_code} onChange={set('postal_code')} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={pending} className="btn-primary !py-1.5 text-sm">
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={() => setEditing(false)} disabled={pending} className="btn-outline !py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function RegistrationManager({ registration, options }) {
  const parts = registration.participants ?? [];
  const total = parts.reduce((s, p) => s + (p.fee_cents ?? 0), 0);
  const adjustments = parts.reduce(
    (s, p) => s + (p.scholarship_cents ?? 0) + (p.discount_cents ?? 0),
    0
  );

  return (
    <div>
      <div className="mb-4">
        <Link href="/admin/rosters" className="text-sm text-brand underline">
          ← Back to rosters
        </Link>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h1 className="text-2xl font-bold">{registration.event?.name ?? 'Registration'}</h1>
        <span className="text-sm text-neutral-500">
          {parts.length} {parts.length === 1 ? 'person' : 'people'} · Fees {money(total)}
          {adjustments > 0 && (
            <span className="text-green-700"> − {money(adjustments)} scholarships/discounts</span>
          )}{' '}
        </span>
        <a
          href={`/admin/registrations/${registration.id}/statement`}
          className="btn-outline !py-1.5 text-sm"
        >
          Family statement (print)
        </a>
      </div>
      <p className="text-sm text-neutral-500 mb-6">
        Review and update this family. Status changes and edits save immediately.
      </p>

      <div className="space-y-6">
        <HouseholdEditor registrationId={registration.id} household={registration.household} />

        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h2 className="text-lg font-bold mb-1">People on this week</h2>
          <p className="text-sm text-neutral-500 mb-2">
            Change a status to move someone off &ldquo;submitted — pending review.&rdquo;
          </p>
          {parts.length === 0 ? (
            <p className="text-neutral-500 text-sm py-2">Nobody is on this registration yet.</p>
          ) : (
            <div>
              {parts.map((p) => (
                <ParticipantRow key={p.id} registrationId={registration.id} participant={p} />
              ))}
            </div>
          )}
          <AddPerson registrationId={registration.id} options={options} />
        </div>

        {registration.family_notes && (
          <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
            <h2 className="text-lg font-bold mb-2">Notes from the family</h2>
            <p className="text-sm text-neutral-700 whitespace-pre-wrap">{registration.family_notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
