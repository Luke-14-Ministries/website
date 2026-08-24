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
  addFamilyMessage,
  deleteFamilyMessage,
  setParticipantEnrollment,
  setPersonConsent,
} from './actions';

const TSHIRT_SIZES = [
  'Youth S', 'Youth M', 'Youth L',
  'Adult S', 'Adult M', 'Adult L', 'Adult XL', 'Adult 2XL', 'Adult 3XL',
];

const SIGNER_ROLE_LABEL = {
  self: 'for themselves',
  parent: 'as a parent',
  guardian: 'as a legal guardian',
  account_holder: 'as the account holder',
};

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
const ROLE_ORDER = ROLE_OPTIONS.map(([v]) => v);
const ROLE_PLURAL = {
  camper: 'Campers',
  parent_guardian: 'Parents / Guardians',
  sibling: 'Siblings',
  caregiver: 'Caregivers',
  volunteer: 'Volunteers',
  childcare: 'Childcare',
  support_team: 'Support team',
};
const ROLE_BADGE = {
  camper: 'bg-teal-100 text-teal-800',
  parent_guardian: 'bg-neutral-200 text-neutral-700',
  sibling: 'bg-neutral-200 text-neutral-700',
  caregiver: 'bg-purple-100 text-purple-800',
  volunteer: 'bg-amber-100 text-amber-800',
  childcare: 'bg-blue-100 text-blue-800',
  support_team: 'bg-blue-100 text-blue-800',
};

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
          <label className={labelCls}>Sex</label>
          <select className={inputCls} value={f.gender} onChange={set('gender')}>
            <option value="">— select —</option>
            <option>Male</option>
            <option>Female</option>
            {/* Preserve any nonstandard value already on the record. */}
            {f.gender && !['Male', 'Female'].includes(f.gender) && (
              <option>{f.gender}</option>
            )}
          </select>
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
  const [enrolling, setEnrolling] = useState(false);
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
            <span
              className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold align-middle ${
                ROLE_BADGE[participant.camp_role] ?? 'bg-neutral-200 text-neutral-700'
              }`}
            >
              {ROLE_LABEL[participant.camp_role] ?? participant.camp_role}
            </span>
          </p>
          <p className="text-sm text-neutral-500">
            {money(participant.fee_cents)}
            {(participant.scholarship_cents ?? 0) > 0 && (
              <span className="text-green-700"> − {money(participant.scholarship_cents)} scholarship</span>
            )}
            {(participant.discount_cents ?? 0) > 0 && (
              <span className="text-green-700"> − {money(participant.discount_cents)} discount</span>
            )}
            {p.date_of_birth ? ` · b. ${p.date_of_birth}` : ' · no DOB on file'}
            {participant.tshirt_size ? ` · ${participant.tshirt_size}` : ''}
          </p>
          {/* Surfaced on the summary line, not hidden behind the editor: a
              registrar looking at a family should not have to open a panel to
              discover the family asked us not to photograph someone. */}
          {(participant.media?.granted === false ||
            participant.directory?.granted === false ||
            participant.first_time_attending === true) && (
            <p className="mt-1 flex flex-wrap gap-1">
              {participant.media?.granted === false && (
                <span className="rounded-full bg-neutral-800 text-white px-2 py-0.5 text-[11px] font-semibold">
                  no photos
                </span>
              )}
              {participant.directory?.granted === false && (
                <span className="rounded-full bg-neutral-200 text-neutral-700 px-2 py-0.5 text-[11px] font-semibold">
                  not in directory
                </span>
              )}
              {participant.first_time_attending === true && (
                <span className="rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-[11px] font-semibold">
                  first time
                </span>
              )}
            </p>
          )}
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
        <button onClick={() => setEnrolling((v) => !v)} className="text-brand underline">
          {enrolling ? 'Close' : 'Enrollment details'}
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
      {enrolling && (
        <EnrollmentEditor
          registrationId={registrationId}
          participant={participant}
          onDone={() => setEnrolling(false)}
        />
      )}
    </div>
  );
}

// --- enrolment answers and permissions, per person ---------------------------
//
// T-shirt size and "first time?" are ordinary edits. The two permissions are
// not: person_consents is append-only, so saving one INSERTS a new dated row
// rather than overwriting the old answer. A withdrawn permission must not
// erase the fact that an earlier one was in force when something was
// published, which is why staff can record a change here but nothing on this
// screen can rewrite history.
function EnrollmentEditor({ registrationId, participant, onDone }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [tshirt, setTshirtRaw] = useState(participant.tshirt_size ?? '');
  const [firstTime, setFirstTimeRaw] = useState(
    participant.first_time_attending === true
      ? 'true'
      : participant.first_time_attending === false
        ? 'false'
        : ''
  );
  // Any edit flips the button back from "Saved" to "Save" (site-wide pattern,
  // 24 Aug -- the old behavior here closed the panel a beat after saving,
  // which read as the option disappearing).
  const setTshirt = (v) => {
    setSaved(false);
    setTshirtRaw(v);
  };
  const setFirstTime = (v) => {
    setSaved(false);
    setFirstTimeRaw(v);
  };
  const personId = participant.person?.id;
  const who = participant.person?.first_name || 'this person';

  function saveEnrollment() {
    setError('');
    start(async () => {
      const res = await setParticipantEnrollment(registrationId, participant.id, {
        tshirt,
        firstTime,
      });
      if (!res.ok) setError(res.error);
      else {
        // The panel STAYS OPEN and the button says Saved -- no auto-close.
        setSaved(true);
        router.refresh();
      }
    });
  }

  function saveConsent(kind, granted) {
    setError('');
    start(async () => {
      const res = await setPersonConsent(registrationId, personId, kind, granted);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm">
      {/* Two separate things in one panel, and testing asked the fair question
          -- why are they grouped at all? Because they share one trait that
          matters more than their subject: both are answers the FAMILY gave on
          the registration form, and this is the one screen where staff can
          correct them for a family who phoned in. They are not, however, the
          same KIND of record, so each half now says what it is:
          enrolment answers overwrite; permissions never do (see below). */}
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
        Enrollment answers
      </p>
      <p className="text-xs text-neutral-500 mb-2">
        Ordinary edits — saving replaces the previous answer.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">T-shirt size</span>
          <select
            value={tshirt}
            onChange={(e) => setTshirt(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1 bg-white"
          >
            <option value="">— not answered —</option>
            {TSHIRT_SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">First time?</span>
          <select
            value={firstTime}
            onChange={(e) => setFirstTime(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1 bg-white"
          >
            <option value="">— not answered —</option>
            <option value="true">Yes</option>
            <option value="false">No — been before</option>
          </select>
        </label>
        <button onClick={saveEnrollment} disabled={pending} className="btn-primary !py-1.5 text-sm">
          {pending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      <div className="mt-4 space-y-2 border-t border-neutral-200 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Permissions
        </p>
        <p className="text-xs text-neutral-500">
          A different kind of record: these are kept as a dated history, never
          overwritten.
        </p>
        <ConsentRow
          label="Photos & video"
          help={`We may feature ${who} in published material. Recording "no" does not promise they never appear in a wide group shot.`}
          record={participant.media}
          disabled={pending || !personId}
          onSet={(v) => saveConsent('media', v)}
        />
        <ConsentRow
          label="Participant directory"
          help={`Include ${who} in the list shared with other attending families.`}
          record={participant.directory}
          disabled={pending || !personId}
          onSet={(v) => saveConsent('directory', v)}
        />
        <p className="text-xs text-neutral-500">
          Changing one of these records a new dated entry — the previous answer is kept, not
          replaced.
        </p>
      </div>

      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

function ConsentRow({ label, help, record, disabled, onSet }) {
  const value = record?.granted;
  const state =
    value === true ? ['Yes', 'bg-green-100 text-green-800'] :
    value === false ? ['No', 'bg-red-100 text-red-800'] :
    ['Never asked', 'bg-neutral-200 text-neutral-600'];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold w-40 shrink-0">{label}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${state[1]}`}>
        {state[0]}
      </span>
      {record?.recorded_at && (
        <span className="text-xs text-neutral-500">
          {record.recorded_at.slice(0, 10)}
          {record.recorded_as === 'staff' ? ' · entered by staff' : ' · from the family'}
        </span>
      )}
      <span className="ml-auto flex gap-2">
        <button
          type="button"
          onClick={() => onSet(true)}
          disabled={disabled || value === true}
          className="btn-outline !py-1 !px-3 text-xs disabled:opacity-40"
        >
          Set yes
        </button>
        <button
          type="button"
          onClick={() => onSet(false)}
          disabled={disabled || value === false}
          className="btn-outline !py-1 !px-3 text-xs disabled:opacity-40"
        >
          Set no
        </button>
      </span>
      <p className="w-full text-xs text-neutral-500">{help}</p>
    </div>
  );
}

// --- what this household signed ----------------------------------------------
function AgreementsCard({ signatures }) {
  if (!signatures || signatures.length === 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="font-semibold text-amber-900">No signed agreements on file</p>
        <p className="mt-1 text-sm text-amber-800">
          Nothing has been signed for this registration. Families sign during registration;
          a registration created by staff by hand will not have them, and neither will one
          submitted before agreements were introduced (23 Aug 2026).
        </p>
      </div>
    );
  }

  const first = signatures[0];
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="font-semibold">Signed agreements</p>
      <p className="mt-1 text-sm text-neutral-600">
        Signed by <strong>{first.signerName}</strong>{' '}
        {SIGNER_ROLE_LABEL[first.signerRole] ?? ''} on{' '}
        {new Date(first.signedAt).toLocaleString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}
        .
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {signatures.map((s) => (
          <li key={s.id} className="flex flex-wrap items-baseline gap-2">
            <span className="text-green-700" aria-hidden>
              ✓
            </span>
            <span className="font-medium">{s.title}</span>
            {s.version != null && (
              <span className="text-xs text-neutral-400">version {s.version}</span>
            )}
            {s.status !== 'signed_here' && (
              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
                {s.status.replace(/_/g, ' ')}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">
        Signatures are never rewritten — the date on a release is part of the record. If the
        board revises an agreement, the new version is signed alongside, not over the top.
      </p>
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
    gender: '',
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
          <label className={labelCls}>Sex</label>
          <select className={inputCls} value={f.gender} onChange={set('gender')}>
            <option value="">— select —</option>
            <option>Male</option>
            <option>Female</option>
          </select>
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
    home_church: household.home_church ?? '',
    how_did_you_hear: household.how_did_you_hear ?? '',
    how_did_you_hear_from: household.how_did_you_hear_from ?? '',
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
            {(household.home_church || household.how_did_you_hear) && (
              <p className="text-sm text-neutral-500 mt-1">
                {household.home_church && <>Church: {household.home_church}</>}
                {household.home_church && household.how_did_you_hear && ' · '}
                {household.how_did_you_hear && (
                  <>
                    Heard about us: {household.how_did_you_hear}
                    {household.how_did_you_hear_from ? ` (${household.how_did_you_hear_from})` : ''}
                  </>
                )}
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
        <div>
          <label className={labelCls}>Home church</label>
          <input className={inputCls} value={f.home_church} onChange={set('home_church')} />
        </div>
        <div>
          {/* Asked once, at the family's first registration, and never again --
              so this is the only place a wrong or missing answer can be
              corrected. */}
          <label className={labelCls}>How they heard about us</label>
          <input
            className={inputCls}
            value={f.how_did_you_hear}
            onChange={set('how_did_you_hear')}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Who from / detail</label>
          <input
            className={inputCls}
            value={f.how_did_you_hear_from}
            onChange={set('how_did_you_hear_from')}
          />
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

// Short notes TO the family — shown on their dashboard the moment they're
// saved. Kept separate from the staff-internal registration notes.
function FamilyMessages({ registrationId, messages }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function add() {
    if (!body.trim()) return;
    setPending(true);
    setError('');
    const res = await addFamilyMessage(registrationId, body);
    setPending(false);
    if (!res?.ok) setError(res?.error || 'Could not save.');
    else {
      setBody('');
      router.refresh();
    }
  }
  async function remove(id) {
    if (!confirm('Remove this note? The family will no longer see it.')) return;
    const res = await deleteFamilyMessage(registrationId, id);
    if (!res?.ok) setError(res?.error || 'Could not remove.');
    else router.refresh();
  }

  return (
    <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
      <h2 className="text-lg font-bold mb-1">Notes to the family</h2>
      <p className="text-sm text-neutral-500 mb-3">
        Shown on the family&rsquo;s dashboard under this registration — e.g. &ldquo;We added a
        $100 scholarship credit to your registration on 8/17.&rdquo; For staff-only notes, use
        the fields above instead.
      </p>
      {messages.length > 0 && (
        <ul className="mb-4 space-y-2">
          {messages.map((m) => (
            <li key={m.id} className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
              <p className="text-neutral-800 whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 flex items-center justify-between text-xs text-neutral-500">
                <span>
                  {m.author} · {m.at}
                </span>
                <button onClick={() => remove(m.id)} className="text-red-700 underline">
                  Remove
                </button>
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a short note the family will see…"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          maxLength={1000}
        />
        <button onClick={add} disabled={pending || !body.trim()} className="btn-primary !py-2 text-sm">
          {pending ? 'Saving…' : 'Post note'}
        </button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}

export default function RegistrationManager({
  registration,
  options,
  adjustmentRecords = [],
  familyMessages = [],
  signatures = [],
  balance = null,
}) {
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
          )}
          {/* The number a registrar opening a family actually wants (24 Aug):
              what is still OWED — paid and balance from the same view the
              dashboard and Event Payments read, so the three never disagree. */}
          {balance && (
            <>
              {' '}
              · Paid {money(balance.paid_cents)} ·{' '}
              <span
                className={`font-bold ${
                  (balance.balance_cents ?? 0) > 0
                    ? 'text-amber-700'
                    : (balance.balance_cents ?? 0) < 0
                      ? 'text-green-700'
                      : 'text-neutral-700'
                }`}
              >
                {(balance.balance_cents ?? 0) < 0
                  ? `Credit ${money(-balance.balance_cents)}`
                  : `Balance ${money(balance.balance_cents)}`}
              </span>
            </>
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

        <AgreementsCard signatures={signatures} />

        <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
          <h2 className="text-lg font-bold mb-1">People on this week</h2>
          <p className="text-sm text-neutral-500 mb-2">
            Change a status to move someone off &ldquo;submitted — pending review.&rdquo;
          </p>
          {parts.length === 0 ? (
            <p className="text-neutral-500 text-sm py-2">Nobody is on this registration yet.</p>
          ) : (
            <div>
              {ROLE_ORDER.filter((role) => parts.some((p) => p.camp_role === role)).map((role) => {
                const group = parts.filter((p) => p.camp_role === role);
                const manyRoles = new Set(parts.map((p) => p.camp_role)).size > 1;
                return (
                  <div key={role}>
                    {manyRoles && (
                      <p className="mt-4 mb-1 text-xs font-bold uppercase tracking-wide text-neutral-400">
                        {ROLE_PLURAL[role] ?? role} ({group.length})
                      </p>
                    )}
                    {group.map((p) => (
                      <ParticipantRow key={p.id} registrationId={registration.id} participant={p} />
                    ))}
                  </div>
                );
              })}
              {parts
                .filter((p) => !ROLE_ORDER.includes(p.camp_role))
                .map((p) => (
                  <ParticipantRow key={p.id} registrationId={registration.id} participant={p} />
                ))}
            </div>
          )}
          <AddPerson registrationId={registration.id} options={options} />

          {/* The scholarship/discount record: who granted what, and when.
              Comes from the scholarships audit table (one row per person,
              kept current by the adjustments editor). */}
          {adjustmentRecords.length > 0 && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-sm font-semibold text-neutral-700 mb-1">
                Scholarship &amp; discount record
              </p>
              <ul className="text-xs text-neutral-600 space-y-1">
                {adjustmentRecords.map((r, i) => {
                  const person = parts.find((p) => p.id === r.participantId)?.person;
                  const who = person ? `${person.first_name} ${person.last_name}` : 'Removed person';
                  return (
                    <li key={i}>
                      <span className="font-medium text-neutral-800">{who}</span>
                      {' — '}
                      {r.status === 'withdrawn'
                        ? 'assistance withdrawn'
                        : `${money(r.grantedCents)} ${r.status}`}
                      {r.grantedBy && <> · by {r.grantedBy}</>}
                      {r.at && <> · {String(r.at).slice(0, 10)}</>}
                      {r.note && <> · &ldquo;{r.note}&rdquo;</>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <FamilyMessages registrationId={registration.id} messages={familyMessages} />

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
