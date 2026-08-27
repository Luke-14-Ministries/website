'use client';

// The staff view of volunteers: per event, each volunteer's application
// status, the application answers, approve/decline, and the background-check
// record (a yes/no and dates — documents stay in the restricted SharePoint
// folder). Actions live in ./actions.js; RLS is the backstop.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { reviewVolunteerApplication, setVolunteerClearance } from './actions';

const APP_CHIP = {
  applied: ['Applied — needs review', 'bg-amber-100 text-amber-800'],
  approved: ['Approved', 'bg-green-100 text-green-800'],
  declined: ['Declined', 'bg-red-100 text-red-800'],
  withdrawn: ['Withdrawn', 'bg-neutral-200 text-neutral-600'],
};

// Checkr report states, mirrored into volunteer_clearances.checkr_status by the
// webhook handler once that exists. Nothing writes these today -- the columns
// and this display are the placeholder, so the shape of the finished feature is
// visible (and reviewable) before any key is issued.
const CHECKR_CHIP = {
  not_started: ['Not started', 'bg-neutral-100 text-neutral-500'],
  invited: ['Invited — waiting on volunteer', 'bg-amber-100 text-amber-800'],
  pending: ['Running at Checkr', 'bg-blue-100 text-blue-800'],
  clear: ['Clear', 'bg-green-100 text-green-800'],
  consider: ['Consider — needs a decision', 'bg-red-100 text-red-800'],
  suspended: ['Suspended at Checkr', 'bg-red-100 text-red-800'],
  dispute: ['Disputed by volunteer', 'bg-amber-100 text-amber-800'],
  canceled: ['Cancelled', 'bg-neutral-200 text-neutral-600'],
};

const ADJUDICATION_LABEL = {
  engaged: 'Engaged — proceeding despite the result',
  pre_adverse_action: 'Pre-adverse action notice sent',
  post_adverse_action: 'Post-adverse action — declined',
};

const fmtAge = (dob) => {
  if (!dob) return null;
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
  return age;
};

function ClearanceEditor({ personId, clearance, email, onDone }) {
  const router = useRouter();
  const [onFile, setOnFile] = useState(Boolean(clearance?.background_check_on_file));
  const [date, setDate] = useState(clearance?.background_check_date ?? '');
  const [expires, setExpires] = useState(clearance?.expires_on ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setPending(true);
    setError('');
    const res = await setVolunteerClearance({ personId, onFile, date: date || null, expires: expires || null });
    setPending(false);
    if (!res?.ok) setError(res?.error || 'Could not save.');
    else {
      onDone?.();
      router.refresh();
    }
  }

  return (
    <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
      <p className="font-semibold text-neutral-700 mb-2">Background check record</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onFile} onChange={(e) => setOnFile(e.target.checked)} className="h-4 w-4" />
          Paperwork on file (in the restricted SharePoint folder)
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">Check date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-neutral-300 px-2 py-1" />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-neutral-500 mb-0.5">Expires</span>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="rounded border border-neutral-300 px-2 py-1" />
        </label>
        <button onClick={save} disabled={pending} className="btn-primary !py-1.5 text-sm">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className="mt-2 text-red-700">{error}</p>}

      <CheckrPanel clearance={clearance} email={email} />
    </div>
  );
}

// PLACEHOLDER. The database columns behind this are live (migration 0029) but
// nothing writes them yet: no API key has been issued and no webhook handler
// exists. It is here so the shape of the finished feature -- and the promise
// that we never touch a Social Security number -- is visible and reviewable
// before anyone wires it up.
function CheckrPanel({ clearance, email }) {
  const status = clearance?.checkr_status ?? 'not_started';
  const [label, tone] = CHECKR_CHIP[status] ?? CHECKR_CHIP.not_started;
  const started = status !== 'not_started';

  return (
    <div className="mt-3 rounded border border-dashed border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-neutral-700">
          Checkr background check{' '}
          <span className="ml-1 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
            not connected yet
          </span>
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
      </div>

      <p className="mt-2 text-xs text-neutral-600">
        When this is switched on, Checkr is sent an email address and nothing else. Checkr
        emails the volunteer, the volunteer enters their Social Security number and date of
        birth into <em>Checkr&rsquo;s</em> form, and the result comes back to us as a
        pass/fail. Luke 14 never receives, transmits, or stores the number — which is the
        whole reason to use the API rather than a form of our own.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled
          title="Not available yet — needs a Checkr account administrator and an API key. See the Staff Questions log, section 8."
          className="btn-outline !py-1 !px-3 text-sm opacity-50 cursor-not-allowed"
        >
          Send background-check invitation
        </button>
        <span className="text-xs text-neutral-500">
          would go to {email || 'this volunteer’s email — none on file'}
        </span>
      </div>

      {started && (
        <dl className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div>
            <dt className="font-semibold text-neutral-500">Invited</dt>
            <dd>{clearance?.invitation_sent_at?.slice(0, 10) ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-500">Report completed</dt>
            <dd>{clearance?.report_completed_at?.slice(0, 10) ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-500">Package</dt>
            <dd>{clearance?.checkr_package ?? '—'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-neutral-500">Decision</dt>
            <dd>{ADJUDICATION_LABEL[clearance?.adjudication] ?? '—'}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function VolunteerRow({ row }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Arriving from the roster (25 Aug). A staff member looking at a volunteer
  // on the roster and wanting their background check had no way across; the
  // link back the other way has always existed. Landing on a collapsed row
  // among thirty others is barely better than not linking at all, so the
  // target opens itself and says which one it is.
  const anchorId = `v-${row.participantId}`;
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    const check = () => {
      const hit = window.location.hash === `#${anchorId}`;
      setLinked(hit);
      if (hit) setOpen(true);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [anchorId]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { person, household, app, clearance } = row;
  const age = fmtAge(person?.date_of_birth);
  const chip = app ? APP_CHIP[app.status] : ['No application yet', 'bg-neutral-100 text-neutral-500'];

  async function review(decision) {
    setPending(true);
    setError('');
    const res = await reviewVolunteerApplication(row.participantId, decision);
    setPending(false);
    if (!res?.ok) setError(res?.error || 'Could not save.');
    else router.refresh();
  }

  const cleared = clearance?.background_check_on_file;
  const expired = cleared && clearance?.expires_on && clearance.expires_on < new Date().toISOString().slice(0, 10);

  return (
    <div
      id={anchorId}
      className={`scroll-mt-4 border-t border-neutral-100 py-3 ${
        linked ? 'rounded-lg bg-brand-light/50 ring-2 ring-brand px-3' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {person?.first_name} {person?.last_name}
            {age != null && age < 18 && (
              <span className="ml-2 rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-semibold">
                under 18
              </span>
            )}
          </p>
          <p className="text-xs text-neutral-500">
            <Link href={`/admin/registrations/${row.registrationId}`} className="text-brand underline">
              {household?.display_name ?? 'Household'}
            </Link>
            {person?.email && <> · {person.email}</>}
            {person?.phone && <> · {person.phone}</>}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-0.5 font-semibold ${chip[1]}`}>{chip[0]}</span>
          <span
            className={`rounded-full px-2.5 py-0.5 font-semibold ${
              expired
                ? 'bg-red-100 text-red-800'
                : cleared
                  ? 'bg-green-100 text-green-800'
                  : 'bg-neutral-100 text-neutral-500'
            }`}
          >
            {expired
              ? `Background check expired ${clearance.expires_on}`
              : cleared
                ? `Background check on file${clearance?.background_check_date ? ` · ${clearance.background_check_date}` : ''}`
                : 'No background check on file'}
          </span>
          <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline !py-1 !px-3">
            {open ? 'Close' : 'Details'}
          </button>
        </span>
      </div>

      {open && (
        <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-4 text-sm">
          {app ? (
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mb-3">
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Age</dt>
                <dd>
                  {age != null ? `${age}` : 'unknown — no birth date on file'}
                  {person?.date_of_birth && (
                    <span className="text-neutral-500"> (b. {person.date_of_birth})</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Sex / gender</dt>
                <dd>{person?.gender || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Preferred areas</dt>
                <dd>{app.preferred_areas || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">First time?</dt>
                <dd>{app.first_time_volunteering == null ? '—' : app.first_time_volunteering ? 'Yes' : 'No — returning'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Home church</dt>
                <dd>{app.church_attendance || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-neutral-500">Accompanying adult</dt>
                <dd>{app.accompanyingAdultName || (age != null && age < 18 ? '⚠ none named' : '—')}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-neutral-500">Faith</dt>
                <dd className="whitespace-pre-wrap">{app.faith_statement || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-neutral-500">Skills</dt>
                <dd className="whitespace-pre-wrap">{app.relevant_skills || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-neutral-500">Disability experience</dt>
                <dd className="whitespace-pre-wrap">{app.disability_experience || '—'}</dd>
              </div>
            </dl>
          ) : (
            <div className="mb-3">
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 mb-3">
                <div>
                  <dt className="text-xs font-semibold text-neutral-500">Age</dt>
                  <dd>
                    {age != null ? `${age}` : 'unknown — no birth date on file'}
                    {person?.date_of_birth && (
                      <span className="text-neutral-500"> (b. {person.date_of_birth})</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-neutral-500">Sex / gender</dt>
                  <dd>{person?.gender || '—'}</dd>
                </div>
              </dl>
              <p className="text-neutral-500">
                No application filed yet — the family completes it at /register/volunteer (their
                dashboard reminds them).
              </p>
            </div>
          )}

          {app && app.status !== 'withdrawn' && (
            <div className="flex flex-wrap gap-2">
              {app.status !== 'approved' && (
                <button onClick={() => review('approved')} disabled={pending} className="btn-primary !py-1.5 text-sm">
                  Approve
                </button>
              )}
              {app.status !== 'declined' && (
                <button
                  onClick={() => review('declined')}
                  disabled={pending}
                  className="rounded border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
                >
                  Decline
                </button>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-red-700 text-sm">{error}</p>}

          <ClearanceEditor
            personId={person?.id}
            clearance={clearance}
            email={person?.email || household?.email}
          />
        </div>
      )}
    </div>
  );
}

export default function VolunteerManager({ groups }) {
  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  const needsReview = groups.reduce(
    (s, g) => s + g.rows.filter((r) => r.app?.status === 'applied').length,
    0
  );
  const noApp = groups.reduce((s, g) => s + g.rows.filter((r) => !r.app).length, 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-bold mb-1">Volunteers</h2>
        {/* Ordering checks is a batch job, not a per-person one -- Checkr's
            bulk upload takes a whole list at once -- so it gets its own screen
            rather than a button on every row. */}
        <Link href="/admin/volunteers/screening" className="btn-outline !py-2 shrink-0">
          Background screening
        </Link>
      </div>
      <p className="text-sm text-neutral-500 mb-6 max-w-prose">
        Everyone registered with the Volunteer role, with their application and background-check
        record. The check paperwork itself lives in the restricted SharePoint folder — only the
        yes/no and dates are recorded here.
      </p>

      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        <span className="rounded-lg bg-white border border-neutral-200 px-4 py-2">
          <span className="font-bold text-lg">{total}</span> registered
        </span>
        <span className="rounded-lg bg-white border border-neutral-200 px-4 py-2">
          <span className="font-bold text-lg text-amber-700">{needsReview}</span> awaiting review
        </span>
        <span className="rounded-lg bg-white border border-neutral-200 px-4 py-2">
          <span className="font-bold text-lg text-neutral-600">{noApp}</span> no application yet
        </span>
      </div>

      {total === 0 && (
        <p className="text-neutral-500">
          No volunteers registered yet. Volunteers register through the ordinary registration
          flow with the role &ldquo;Volunteer,&rdquo; then complete their application.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.event.id} className="rounded-lg bg-white border border-neutral-200 shadow-sm p-5 mb-6">
          <h3 className="font-bold">
            {g.event.name}
            {g.event.starts_on && (
              <span className="font-normal text-sm text-neutral-500">
                {' '}
                ({g.event.starts_on} – {g.event.ends_on})
              </span>
            )}
          </h3>
          <div>
            {g.rows.map((r) => (
              <VolunteerRow key={r.participantId} row={r} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
