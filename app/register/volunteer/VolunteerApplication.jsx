'use client';

// One volunteer's application card: prefilled if they've applied before,
// resubmittable after edits (which puts it back under review), withdrawable.
// The save happens in ./actions.js, where ownership is checked server-side;
// RLS is the backstop.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitVolunteerApplication, withdrawVolunteerApplication } from './actions';

const AREAS = [
  'Buddy (one-on-one with a camper)',
  'Children/Youth programs',
  'Kitchen & meals',
  'Music & worship',
  'Recreation & activities',
  'Media & photography',
  'Wherever I am needed most',
];

const STATUS_CHIP = {
  applied: ['Submitted — under review', 'bg-amber-100 text-amber-800'],
  approved: ['Approved', 'bg-green-100 text-green-800'],
  declined: ['Not approved — you can update and resubmit', 'bg-red-100 text-red-800'],
  withdrawn: ['Withdrawn', 'bg-neutral-200 text-neutral-600'],
};

const input = 'w-full rounded border border-neutral-300 px-4 py-2.5';
const label = 'block font-semibold mb-1.5 mt-4 first:mt-0';

export default function VolunteerApplication({
  participantId,
  personId,
  personName,
  isMinor,
  eventName,
  existing,
  adults,
  defaultChurch = '',
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!existing); // new applications start open
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [firstTime, setFirstTime] = useState(
    existing?.first_time_volunteering == null ? '' : existing.first_time_volunteering ? 'yes' : 'no'
  );
  const [picked, setPicked] = useState(
    existing?.preferred_areas ? existing.preferred_areas.split(' · ') : []
  );
  // Their saved application answer wins; otherwise start from the household's
  // home church, which the registration wizard already collected.
  const [church, setChurch] = useState(existing?.church_attendance ?? defaultChurch ?? '');
  const [faith, setFaith] = useState(existing?.faith_statement ?? '');
  const [skills, setSkills] = useState(existing?.relevant_skills ?? '');
  const [experience, setExperience] = useState(existing?.disability_experience ?? '');
  const [adultId, setAdultId] = useState(existing?.accompanying_adult_person_id ?? '');

  const togglePick = (a) =>
    setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  async function save() {
    setPending(true);
    setError('');
    const res = await submitVolunteerApplication({
      participantId,
      firstTime: firstTime === '' ? null : firstTime === 'yes',
      preferredAreas: picked.join(' · '),
      church,
      faith,
      skills,
      experience,
      accompanyingAdultId: adultId || null,
    });
    setPending(false);
    if (!res?.ok) {
      setError(res?.error || 'Something went wrong — please try again.');
      return;
    }
    setSaved(true);
    setOpen(false);
    router.refresh();
  }

  async function withdraw() {
    if (!window.confirm('Withdraw this application? You can resubmit any time.')) return;
    setPending(true);
    const res = await withdrawVolunteerApplication(participantId);
    setPending(false);
    if (!res?.ok) setError(res?.error || 'Something went wrong — please try again.');
    else router.refresh();
  }

  const chip = existing ? STATUS_CHIP[existing.status] : null;

  return (
    <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">
            {personName}
            {isMinor && (
              <span className="ml-2 rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-semibold align-middle">
                under 18
              </span>
            )}
          </h2>
          <p className="text-sm text-neutral-500">{eventName}</p>
        </div>
        <span className="flex items-center gap-2">
          {saved && !existing && (
            <span className="rounded-full bg-green-100 text-green-800 px-2.5 py-0.5 text-xs font-semibold">
              Application submitted
            </span>
          )}
          {chip && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip[1]}`}>
              {chip[0]}
            </span>
          )}
          <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline !py-1.5 text-sm">
            {open ? 'Close' : existing ? 'View / edit' : 'Start application'}
          </button>
        </span>
      </div>

      {open && (
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <label className={label}>Where would you like to serve? (pick any)</label>
          <div className="grid sm:grid-cols-2 gap-1">
            {AREAS.map((a) => (
              <label key={a} className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={picked.includes(a)}
                  onChange={() => togglePick(a)}
                  className="h-4 w-4"
                />
                {a}
              </label>
            ))}
          </div>

          <label className={label}>Is this your first time volunteering with us?</label>
          <div className="flex gap-4 text-sm text-neutral-700">
            {['yes', 'no'].map((v) => (
              <label key={v} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`first-${participantId}`}
                  checked={firstTime === v}
                  onChange={() => setFirstTime(v)}
                  className="h-4 w-4"
                />
                {v === 'yes' ? 'Yes — first time' : 'No — returning'}
              </label>
            ))}
          </div>

          <label className={label}>Home church (if any)</label>
          <input className={input} value={church} onChange={(e) => setChurch(e.target.value)} />

          <label className={label}>A little about your faith (a sentence or two is plenty)</label>
          <textarea className={input} rows={2} value={faith} onChange={(e) => setFaith(e.target.value)} />

          <label className={label}>Skills you&rsquo;d bring (music, lifeguard, nursing, crafts…)</label>
          <textarea className={input} rows={2} value={skills} onChange={(e) => setSkills(e.target.value)} />

          <label className={label}>Experience with people with disabilities (none needed!)</label>
          <textarea
            className={input}
            rows={2}
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
          />

          {isMinor && (
            <>
              <label className={label}>Accompanying adult (required for volunteers under 18)</label>
              <select className={input} value={adultId} onChange={(e) => setAdultId(e.target.value)}>
                <option value="">— choose an adult —</option>
                {adults
                  .filter((a) => a.id !== personId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                If your accompanying adult isn&rsquo;t listed, add them to your household first
                (or note it in the skills box and our team will follow up).
              </p>
            </>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm px-3 py-2">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={save} disabled={pending} className="btn-primary !py-2">
              {pending ? 'Saving…' : existing ? 'Save & resubmit for review' : 'Submit application'}
            </button>
            {existing && existing.status !== 'withdrawn' && (
              <button onClick={withdraw} disabled={pending} className="btn-outline !py-2">
                Withdraw
              </button>
            )}
          </div>
          <p className="text-xs text-neutral-500 mt-3">
            After you submit, our team reviews the application and contacts you about the
            background check — that step happens through the check provider, never on this site.
          </p>
        </div>
      )}
    </div>
  );
}
