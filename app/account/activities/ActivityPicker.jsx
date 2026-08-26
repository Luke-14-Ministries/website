'use client';

// One person's activity choices for one event.
//
// The three booking modes are not decoration -- they are three different
// things the ministry runs, and each is asked differently:
//
//   interest    "would you like to?" Nothing is held, so the control is a
//               plain tick and capacity is never mentioned.
//   signup      a real place. Capacity is shown honestly, including when it
//               has run out, and the server refuses an oversell even if this
//               page is stale.
//   appointment a specific slot. Treated as signup here until slots are
//               actually scheduled (activity_slots is seeded per event).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setActivityChoice } from './actions';

function Availability({ activity }) {
  if (activity.booking_mode === 'interest' || activity.capacity == null) return null;
  if (activity.placesLeft === 0) {
    return <span className="text-sm font-semibold text-amber-700">Full</span>;
  }
  return (
    <span className="text-sm text-neutral-500">
      {activity.placesLeft} of {activity.capacity} left
    </span>
  );
}

function ActivityRow({ person, activity }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  const existing = person.choices[activity.id] ?? null;
  const isOn = existing?.status === 'interested' || existing?.status === 'signed_up';
  const needsProvider = Boolean(activity.provider_url || activity.provider_name);
  const [ack, setAck] = useState(Boolean(existing?.waiver_acknowledged_at));

  const wantStatus = activity.booking_mode === 'interest' ? 'interested' : 'signed_up';
  const full = activity.placesLeft === 0 && !isOn;

  function toggle(next) {
    setError('');
    start(async () => {
      const res = await setActivityChoice({
        participantId: person.participantId,
        activityId: activity.id,
        status: next ? wantStatus : 'cancelled',
        acknowledgeWaiver: ack,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex flex-1 min-w-0 items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isOn}
            disabled={pending || full}
            onChange={(e) => toggle(e.target.checked)}
            className="mt-1 shrink-0"
          />
          <span className="min-w-0">
            <span className="font-semibold">{activity.name}</span>
            {activity.description && (
              <span className="block text-sm text-neutral-600">{activity.description}</span>
            )}
            {needsProvider && (
              <span className="mt-1 block text-sm text-amber-800">
                Run by {activity.provider_name || 'an outside provider'} — their own form
                has to be completed with them, not here.
                {activity.provider_url && (
                  <>
                    {' '}
                    <a
                      href={activity.provider_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-semibold"
                    >
                      Open their page ↗
                    </a>
                  </>
                )}
              </span>
            )}
          </span>
        </label>
        <span className="shrink-0 pt-1">
          {pending ? (
            <span className="text-sm text-neutral-400">saving…</span>
          ) : (
            <Availability activity={activity} />
          )}
        </span>
      </div>

      {/* The acknowledgement, shown only where it applies and only while it
          still needs giving. It records that we TOLD them -- never that a
          waiver was signed, which is not ours to assert. */}
      {needsProvider && !isOn && (
        <label className="mt-2 ml-7 flex items-start gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I understand {activity.provider_name || 'the provider'} has their own form to
            complete, and that the ministry cannot complete it for us. Staff will send us
            what we need.
          </span>
        </label>
      )}

      {needsProvider && isOn && existing?.waiver_acknowledged_at && (
        <p className="mt-1 ml-7 text-xs text-neutral-500">
          You confirmed you understand their form is yours to complete, on{' '}
          {existing.waiver_acknowledged_at.slice(0, 10)}.
        </p>
      )}

      {full && (
        <p className="mt-1 ml-7 text-sm text-amber-800">
          Full at the moment — <span className="font-semibold">please ask anyway</span>.
          Email info@luke14ministries.net and staff will look at whether the numbers can
          stretch.
        </p>
      )}

      {error && <p className="mt-1 ml-7 text-sm text-red-700">{error}</p>}
    </li>
  );
}

export default function ActivityPicker({ person, activities }) {
  const chosenCount = activities.filter((a) => {
    const c = person.choices[a.id];
    return c && (c.status === 'interested' || c.status === 'signed_up');
  }).length;

  return (
    <div className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h3 className="text-lg font-bold">{person.name}</h3>
        <span className="text-sm text-neutral-500">
          {chosenCount === 0
            ? 'nothing chosen yet'
            : `${chosenCount} ${chosenCount === 1 ? 'activity' : 'activities'} chosen`}
        </span>
      </div>
      <ul className="divide-y divide-neutral-100">
        {activities.map((a) => (
          <ActivityRow key={a.id} person={person} activity={a} />
        ))}
      </ul>
    </div>
  );
}
