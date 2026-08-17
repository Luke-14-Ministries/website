'use client';

import { useState } from 'react';
import Link from 'next/link';
import { submitFamilyRegistration } from './actions';

const emptyMember = {
  personId: null,
  firstName: '',
  lastName: '',
  dob: '',
  role: 'Camper with disability',
  needs: '',
  diet: '',
};

const money = (cents) =>
  `$${((cents ?? 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

const fmtWeek = (w) => {
  // startsOn / endsOn are ISO date strings (YYYY-MM-DD). Format without timezone
  // surprises by parsing the parts directly.
  const d = (s) => {
    const [y, m, day] = s.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };
  return `${w.name} · ${d(w.startsOn)}–${d(w.endsOn)}`;
};

function Steps({ step }) {
  const labels = ['Family Info', 'Family Members', 'Week & Needs', 'Review'];
  return (
    <ol className="flex flex-wrap gap-2 mb-8">
      {labels.map((l, i) => (
        <li
          key={l}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
            i === step
              ? 'bg-brand text-white'
              : i < step
              ? 'bg-brand-light text-brand-dark'
              : 'bg-neutral-100 text-neutral-400'
          }`}
        >
          {i + 1}. {l}
        </li>
      ))}
    </ol>
  );
}

const input = 'w-full rounded border border-neutral-300 px-4 py-2.5';
const label = 'block font-semibold mb-1.5 mt-4 first:mt-0';

// `existing` (from the server page) prefills the whole wizard when this account
// already has a registration -- so "Edit Registration" opens the saved answers,
// not a blank form. isUpdate flips the wording from Submit to Update.
export default function FamilyWizard({ weeks, defaultEmail = '', existing = null }) {
  const isUpdate = existing?.isUpdate === true;

  const [step, setStep] = useState(0);
  const [family, setFamily] = useState(
    existing?.family ?? {
      contactFirst: '',
      contactLast: '',
      email: defaultEmail,
      phone: '',
      address: '',
      church: '',
    }
  );
  const [members, setMembers] = useState(
    existing?.members?.length ? existing.members : [{ ...emptyMember }]
  );
  const [weekIdx, setWeekIdx] = useState(() => {
    const i = weeks.findIndex((w) => w.eventId === existing?.eventId);
    return i >= 0 ? i : 0;
  });
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const week = weeks[weekIdx] ?? weeks[0];
  const namedCount = members.filter((m) => m.firstName.trim() && m.lastName.trim()).length;
  const total = (week?.feeCents ?? 0) * namedCount;

  const setF = (k) => (e) => setFamily({ ...family, [k]: e.target.value });
  const setM = (i, k) => (e) => {
    const next = members.map((m, j) => (j === i ? { ...m, [k]: e.target.value } : m));
    setMembers(next);
  };

  async function handleSubmit() {
    // Soft requirement: date of birth. It is one of the ways family members
    // are told apart, so warn (but do not block) when it is missing.
    const missingDob = members.filter(
      (m) => m.firstName.trim() && m.lastName.trim() && !m.dob
    );
    if (missingDob.length > 0) {
      const names = missingDob.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', ');
      const ok = window.confirm(
        `No date of birth entered for: ${names}.\n\nBirth dates help us tell family members apart, and help program leaders at camp plan resources and accommodations appropriately. Save anyway?`
      );
      if (!ok) return;
    }
    setError('');
    setBusy(true);
    try {
      const res = await submitFamilyRegistration({
        family,
        members,
        eventId: week.eventId,
        optionId: week.optionId,
        notes,
      });
      if (res?.ok) {
        setResult(res);
      } else {
        setError(res?.error || 'Something went wrong. Please try again.');
      }
    } catch (e) {
      setError('Something went wrong submitting your registration. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-lg border-2 border-brand bg-brand-light p-8 text-center">
        <h2 className="text-2xl font-bold text-brand-dark">
          {isUpdate ? 'Registration updated' : 'Registration submitted'}
        </h2>
        <p className="mt-3 text-lg">
          Thank you! We saved {result.saved} {result.saved === 1 ? 'person' : 'people'} for{' '}
          <strong>{week?.name}</strong>.{' '}
          {isUpdate
            ? 'Camp staff can see what changed and will follow up if anything needs attention.'
            : 'Camp staff will review your registration and follow up.'}{' '}
          You can see it any time on your dashboard.
        </p>
        <Link href="/account/dashboard/" className="btn-primary mt-6">
          Go to My Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8">
      <Steps step={step} />

      {step === 0 && (
        <div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Primary contact first name</label>
              <input className={input} value={family.contactFirst} onChange={setF('contactFirst')} />
            </div>
            <div>
              <label className={label}>Primary contact last name</label>
              <input className={input} value={family.contactLast} onChange={setF('contactLast')} />
            </div>
          </div>
          <label className={label}>Email</label>
          <input type="email" className={input} value={family.email} onChange={setF('email')} />
          <label className={label}>Phone</label>
          <input type="tel" className={input} value={family.phone} onChange={setF('phone')} />
          <label className={label}>Home address</label>
          <input className={input} value={family.address} onChange={setF('address')} />
          <label className={label}>Home church (optional)</label>
          <input className={input} value={family.church} onChange={setF('church')} />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-6">
          <p className="text-sm text-neutral-600 rounded bg-neutral-50 border border-neutral-200 px-4 py-3">
            List everyone who will attend — <span className="font-semibold">including yourself</span> if
            you&rsquo;re coming. Support and dietary needs can be noted for any family member, adults
            included. Please include each person&rsquo;s{' '}
            <span className="font-semibold">date of birth</span> — it helps us tell family members
            apart. Each adult&rsquo;s own phone number is managed under{' '}
            <span className="font-semibold">Manage Household</span> on your dashboard.
          </p>
          {members.map((m, i) => (
            <div key={i} className="rounded border border-neutral-200 p-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold">Family member {i + 1}</h3>
                {members.length > 1 && (
                  <button
                    type="button"
                    className="text-red-600 text-sm underline"
                    onClick={() => setMembers(members.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mt-2">
                <div>
                  <label className={label}>First name</label>
                  <input className={input} value={m.firstName} onChange={setM(i, 'firstName')} />
                </div>
                <div>
                  <label className={label}>Last name</label>
                  <input className={input} value={m.lastName} onChange={setM(i, 'lastName')} />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className={label}>Date of birth</label>
                  <input type="date" className={input} value={m.dob} onChange={setM(i, 'dob')} />
                </div>
                <div>
                  <label className={label}>Role</label>
                  <select className={input} value={m.role} onChange={setM(i, 'role')}>
                    <option>Camper with disability</option>
                    <option>Parent/Guardian</option>
                    <option>Sibling</option>
                    <option>Caregiver</option>
                    <option>Volunteer</option>
                  </select>
                </div>
              </div>
              <label className={label}>
                Disability / support needs (buddies, mobility, medical)
              </label>
              <textarea className={input} rows={2} value={m.needs} onChange={setM(i, 'needs')} />
              <label className={label}>Dietary needs / allergies</label>
              <input className={input} value={m.diet} onChange={setM(i, 'diet')} />
            </div>
          ))}
          <button
            type="button"
            className="btn-outline !py-2"
            onClick={() => setMembers([...members, { ...emptyMember }])}
          >
            + Add family member
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <label className={label}>Choose your week</label>
          <div className="space-y-2 mt-2">
            {weeks.map((w, i) => (
              <label
                key={w.optionId}
                className="flex items-center gap-3 rounded border border-neutral-300 p-3 cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand-light"
              >
                <input
                  type="radio"
                  name="week"
                  checked={weekIdx === i}
                  onChange={() => setWeekIdx(i)}
                />
                <span className="font-semibold">{fmtWeek(w)}</span>
              </label>
            ))}
          </div>
          <label className={label}>Anything else camp staff should know?</label>
          <textarea
            className={input}
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="mt-4 rounded bg-brand-light p-4">
            <p className="font-semibold">
              Camp fee: {money(week?.feeCents)} per person
            </p>
            <p className="text-sm text-neutral-600">
              Scholarships available &mdash; contact camp@luke14ministries.net. Payment happens
              from your dashboard after you {isUpdate ? 'update' : 'submit'}.
            </p>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Review</h3>
          <p>
            <strong>Contact:</strong>{' '}
            {`${family.contactFirst} ${family.contactLast}`.trim() || '—'} · {family.email || '—'} ·{' '}
            {family.phone || '—'}
          </p>
          <p>
            <strong>Week:</strong> {week ? fmtWeek(week) : '—'}
          </p>
          <div>
            <strong>Family members ({namedCount}):</strong>
            <ul className="list-disc pl-6 mt-1">
              {members
                .filter((m) => m.firstName.trim() && m.lastName.trim())
                .map((m, i) => (
                  <li key={i}>
                    {m.firstName} {m.lastName}
                    {m.dob ? ` (b. ${m.dob})` : ''} — {m.role}
                  </li>
                ))}
            </ul>
          </div>
          {notes && (
            <p>
              <strong>Notes:</strong> {notes}
            </p>
          )}
          <p className="rounded bg-brand-light p-4">
            <strong>
              Total: {money(total)}
            </strong>{' '}
            — {namedCount} × {money(week?.feeCents)}. Payment is collected from your dashboard.
          </p>
          {namedCount === 0 && (
            <p className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
              Add at least one family member (step 2 — first and last name) before{' '}
              {isUpdate ? 'updating' : 'submitting'}.
            </p>
          )}
          {isUpdate && namedCount > 0 && (
            <p className="text-sm text-neutral-500">
              Updating replaces your saved answers for this week. People are matched by name and
              date of birth, so nobody is duplicated.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800"
            >
              {error}
            </p>
          )}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="btn-outline !py-2 disabled:opacity-40"
            disabled={step === 0 || busy}
            onClick={() => setStep(step - 1)}
          >
            Back
          </button>
          <Link
            href="/account/dashboard/"
            title="Leave without saving changes"
            className="text-neutral-500 font-semibold hover:text-neutral-700 hover:underline"
          >
            Cancel
          </Link>
        </div>
        {step < 3 ? (
          <button
            type="button"
            className="btn-primary !py-2"
            onClick={() => setStep(step + 1)}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            className="btn-gold !py-2 disabled:opacity-50"
            disabled={busy || namedCount === 0}
            title={namedCount === 0 ? 'Add at least one family member first' : undefined}
            onClick={handleSubmit}
          >
            {busy
              ? 'Saving…'
              : isUpdate
              ? 'Update Registration'
              : 'Submit Registration'}
          </button>
        )}
      </div>
    </div>
  );
}
