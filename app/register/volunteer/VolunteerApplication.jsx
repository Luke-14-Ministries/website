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
  creed = null,
  creedAlreadySigned = false,
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

  // The Apostles' Creed affirmation (migration 0062). Starts ticked only if
  // this person has already affirmed THIS version -- a reworded version 2
  // deliberately asks again rather than inheriting an older yes.
  const [creedOk, setCreedOk] = useState(creedAlreadySigned);
  const [creedOpen, setCreedOpen] = useState(false);

  // The stored text is one framing paragraph, a blank line, then the Creed.
  // Splitting on the first blank line lets the framing show inline -- somebody
  // should know WHY they are being asked without opening anything -- while the
  // Creed itself sits behind the button, readable without leaving the page.
  const [creedIntro, ...creedRest] = (creed?.body ?? '').split(/\n\s*\n/);
  const creedText = creedRest.join('\n\n');

  const togglePick = (a) =>
    setPicked((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  async function save() {
    // Checked here so the person is told before a round trip, and again on the
    // server, which is the one that actually holds -- a server action is a
    // public endpoint whatever the form in front of it does.
    if (creed && !creedOk) {
      setError(
        'Please read and affirm the Apostles’ Creed below — it is required of everyone serving at camp.'
      );
      return;
    }
    setPending(true);
    setError('');
    const res = await submitVolunteerApplication({
      creedAffirmed: creedOk,
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
      {/* min-w-0 flex-1 on the text, shrink-0 on the controls. Without them a
          longer event name ("Camp Celebrate 2027 — Week 1 (…)") pushed the
          status chip and the button onto a second line, so two cards on the
          same page were laid out differently and read as two different
          designs (reported 25 Aug). Same fix as the admin header, 24 Aug. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
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
        <span className="flex shrink-0 items-center gap-2">
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

          {/* The cap "(a sentence or two is plenty)" was removed on 29 August 2026 at Lee Anne's
              suggestion: it discouraged an answer we would often rather have in full. The box is
              taller for the same reason -- a two-row box says "keep it short" even without the
              words. These faith questions are on the VOLUNTEER application only; families and
              campers never see them (confirmed by Larry, 29 Aug 2026). */}
          <label className={label}>A little about your faith</label>
          <textarea className={input} rows={4} value={faith} onChange={(e) => setFaith(e.target.value)} />

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

          {creed && (
            <div className="mt-5 rounded-lg border border-brand bg-brand-light/40 p-4">
              <p className="font-semibold text-brand-dark">{creed.title}</p>
              <p className="mt-1.5 text-sm text-neutral-700">{creedIntro}</p>

              <button
                type="button"
                onClick={() => setCreedOpen(true)}
                className="mt-2.5 text-sm font-semibold text-brand underline"
              >
                Read the Apostles&rsquo; Creed
              </button>

              <label className="mt-3 flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-[#14606a]"
                  checked={creedOk}
                  onChange={(e) => setCreedOk(e.target.checked)}
                />
                <span className="text-sm">
                  I have read the Apostles&rsquo; Creed and I affirm it.{' '}
                  <span className="text-red-700 font-semibold">(required)</span>
                </span>
              </label>
            </div>
          )}

          {/* The pop-out. A plain conditional overlay rather than a dialog
              library: one more dependency for one modal is not the trade this
              project makes, and <dialog> still needs a polyfill story on the
              older tablets families actually use at camp. Escape closes it,
              clicking the backdrop closes it, and the panel itself stops the
              click so a mis-aimed tap inside does not dismiss the text
              somebody is halfway through reading. */}
          {creed && creedOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={creed.title}
              tabIndex={-1}
              onKeyDown={(e) => e.key === 'Escape' && setCreedOpen(false)}
              onClick={() => setCreedOpen(false)}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
              >
                <h3 className="text-xl font-bold text-brand-dark">Apostles&rsquo; Creed</h3>
                {/* whitespace-pre-line, because the Creed is set as lines and
                    reads as a list of clauses. Reflowing it into a paragraph
                    would be a change to the thing somebody is affirming. */}
                <p className="mt-3 whitespace-pre-line leading-relaxed">{creedText}</p>
                <button
                  type="button"
                  onClick={() => setCreedOpen(false)}
                  className="btn-primary mt-5"
                  autoFocus
                >
                  Close
                </button>
              </div>
            </div>
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
