'use client';

// The support profile, as one scrolling page of cards — the same shape as
// registration, because a family that has just learned one form should not
// have to learn a second.
//
// Every question follows the same pattern: a plain yes/no, and the detail box
// only appears when the answer is yes. CampSite required free text for all of
// this, and their export is full of "NA" — a required box gets filled, not
// answered. Nothing here is required, and the page says so.

import { useState } from 'react';
import Link from 'next/link';
import PhotoUpload from '@/components/PhotoUpload';
import SaveButton from '@/components/SaveButton';
import { savePersonSupport } from './actions';

const input = 'w-full rounded border border-neutral-300 px-4 py-2.5';
const label = 'block font-semibold mb-1.5 mt-4 first:mt-0';

function Card({ n, title, subtitle, children }) {
  return (
    <section className="rounded-lg border border-neutral-200 shadow-sm bg-white p-6 sm:p-8">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white text-sm font-bold">
          {n}
        </span>
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      {subtitle && <p className="text-sm text-neutral-600 mb-4 ml-10">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

// A yes/no with a detail box that appears only on yes. The detail is asked in
// plain language — "what should we do", not "describe the condition" — because
// what camp staff need is the plan, not the diagnosis.
function YesNo({ id, question, value, onChange, children }) {
  return (
    <div className="mt-5 first:mt-0">
      <p className="font-semibold mb-2">{question}</p>
      <div className="flex gap-2">
        {[
          ['yes', true],
          ['no', false],
        ].map(([labelText, v]) => (
          <label
            key={labelText}
            className={`cursor-pointer rounded border px-4 py-1.5 text-sm font-semibold ${
              value === v
                ? 'border-brand bg-brand-light text-brand-dark'
                : 'border-neutral-300 text-neutral-600'
            }`}
          >
            <input
              type="radio"
              name={id}
              className="sr-only"
              checked={value === v}
              onChange={() => onChange(v)}
            />
            {labelText === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
      {value === true && children}
    </div>
  );
}

export default function DetailsForm({
  person,
  support,
  photoUrl = null,
  backHref = '/account/dashboard/',
}) {
  const s = support ?? {};
  const [f, setF] = useState({
    disabilities: s.disabilities ?? '',
    communication: s.communication ?? '',
    mobility: s.mobility ?? '',
    personal_care: s.personal_care ?? '',
    daily_living_supports: s.daily_living_supports ?? '',
    dietary_needs: s.dietary_needs ?? '',
    medications: s.medications ?? '',
    allergy_detail: s.allergy_detail ?? '',
    seizure_detail: s.seizure_detail ?? '',
    rescue_medication_detail: s.rescue_medication_detail ?? '',
    behaviour_triggers: s.behaviour_triggers ?? '',
    redirection_strategies: s.redirection_strategies ?? '',
    sleep_notes: s.sleep_notes ?? '',
    other_concerns: s.other_concerns ?? '',
    emergency_contact_name: s.emergency_contact_name ?? '',
    emergency_contact_phone: s.emergency_contact_phone ?? '',
    emergency_contact_relationship: s.emergency_contact_relationship ?? '',
    has_allergies: s.has_allergies ?? null,
    has_seizures: s.has_seizures ?? null,
    has_rescue_medication: s.has_rescue_medication ?? null,
    has_sleep_disturbance: s.has_sleep_disturbance ?? null,
    has_caregiver: s.has_caregiver ?? null,
    buddy_required: s.buddy_required ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const set = (k) => (e) => {
    setSaved(false);
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  };
  const setFlag = (k) => (v) => {
    setSaved(false);
    setF((prev) => ({ ...prev, [k]: v }));
  };

  const name = person?.first_name || 'this person';

  async function save() {
    // Soft-required, not required: an emergency contact is the one thing this
    // form asks of everyone, but a family mid-thought should still be able to
    // save and come back. One confirm, then their call. (Whether more fields
    // should be hard-required is with camp staff -- Staff Questions log.)
    if (!f.emergency_contact_name.trim() && !f.emergency_contact_phone.trim()) {
      const ok = window.confirm(
        `Save without an emergency contact?\n\nThis is the one thing we ask for everyone — someone we can reach during the event who is not attending it. You can add it later, but please don't forget.`
      );
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    try {
      // Unanswered flags go as false rather than null: the column is NOT NULL
      // in the schema, and "we asked and they didn't say" is operationally the
      // same as "no" for a yes/no with no detail behind it.
      const payload = { ...f };
      for (const k of [
        'has_allergies',
        'has_seizures',
        'has_rescue_medication',
        'has_sleep_disturbance',
        'has_caregiver',
        'buddy_required',
      ]) {
        payload[k] = payload[k] === true;
      }
      const res = await savePersonSupport(person.id, payload);
      if (res?.ok) setSaved(true);
      else setError(res?.error || 'Something went wrong. Please try again.');
    } catch {
      setError('Something went wrong saving this form. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card
        n={1}
        title={`About ${name}`}
        subtitle="Answer what you can. Every box is optional — a blank tells us as much as a guess, and you can come back and add to this at any time."
      >
        {/* CampSite blocks registration until a photo is uploaded. We ask here
            instead, and do not block: a family without a good photo to hand
            should still be able to secure a place. Staff can see who is
            missing one. */}
        <div className="mb-6 rounded border border-neutral-200 bg-neutral-50 p-4">
          <PhotoUpload personId={person.id} personName={name} initialUrl={photoUrl} />
        </div>

        <label className={label}>
          Disability or diagnosis, in your own words <span className="font-normal text-neutral-500">(optional)</span>
        </label>
        <textarea className={input} rows={2} value={f.disabilities} onChange={set('disabilities')} />

        <label className={label}>How does {name} communicate best?</label>
        <textarea
          className={input}
          rows={2}
          value={f.communication}
          onChange={set('communication')}
          placeholder="Speech, signs, a device, gestures — and anything that helps us understand them"
        />

        <label className={label}>Getting around</label>
        <textarea
          className={input}
          rows={2}
          value={f.mobility}
          onChange={set('mobility')}
          placeholder="Walks independently, uses a wheelchair or walker, tires on hills, needs a hand on stairs…"
        />

        <label className={label}>Personal care</label>
        <textarea
          className={input}
          rows={2}
          value={f.personal_care}
          onChange={set('personal_care')}
          placeholder="Dressing, toileting, showering — what they do themselves and where they need a hand"
        />

        <label className={label}>Anything else about daily routine</label>
        <textarea
          className={input}
          rows={2}
          value={f.daily_living_supports}
          onChange={set('daily_living_supports')}
        />
      </Card>

      <Card
        n={2}
        title="Health"
        subtitle="Camp has medical staff on site. What matters most is what we should DO, not the medical name for it."
      >
        <YesNo
          id="allergies"
          question={`Does ${name} have any allergies?`}
          value={f.has_allergies}
          onChange={setFlag('has_allergies')}
        >
          <label className={label}>What are they, and what happens?</label>
          <textarea
            className={input}
            rows={2}
            value={f.allergy_detail}
            onChange={set('allergy_detail')}
            placeholder="Peanuts — hives and swelling within minutes"
          />
          <p className="mt-1 text-xs text-neutral-500">
            If {name} carries emergency medication for a reaction — an EpiPen, for
            example — record it under <strong>rescue medication</strong> below, so it is
            written down once, in the place staff will look for it.
          </p>
        </YesNo>

        <YesNo
          id="seizures"
          question={`Does ${name} have seizures?`}
          value={f.has_seizures}
          onChange={setFlag('has_seizures')}
        >
          <label className={label}>What do they look like, and what should we do?</label>
          <textarea
            className={input}
            rows={3}
            value={f.seizure_detail}
            onChange={set('seizure_detail')}
            placeholder="How long they usually last, what helps, when to call for help"
          />
        </YesNo>

        <YesNo
          id="rescue"
          question={`Does ${name} carry any rescue or emergency medication?`}
          value={f.has_rescue_medication}
          onChange={setFlag('has_rescue_medication')}
        >
          <label className={label}>What, where is it kept, and when is it used?</label>
          <textarea
            className={input}
            rows={2}
            value={f.rescue_medication_detail}
            onChange={set('rescue_medication_detail')}
            placeholder="EpiPen in her backpack — use for any reaction with facial swelling"
          />
        </YesNo>

        <label className={label}>Regular medications</label>
        <textarea
          className={input}
          rows={3}
          value={f.medications}
          onChange={set('medications')}
          placeholder="Name, dose and when it's taken. Families keep and give their own medications at camp — staff never take them into custody."
        />

        <label className={label}>Dietary needs</label>
        <textarea className={input} rows={2} value={f.dietary_needs} onChange={set('dietary_needs')} />
      </Card>

      <Card
        n={3}
        title="A hard day"
        subtitle="Every camper has one. Knowing what helps in advance means staff can help instead of guess."
      >
        <label className={label}>What tends to set {name} off, or make things harder?</label>
        <textarea
          className={input}
          rows={2}
          value={f.behaviour_triggers}
          onChange={set('behaviour_triggers')}
          placeholder="Loud rooms, changes to the plan, being rushed, hunger…"
        />

        <label className={label}>What helps them settle?</label>
        <textarea
          className={input}
          rows={3}
          value={f.redirection_strategies}
          onChange={set('redirection_strategies')}
          placeholder="A quiet corner, a favourite song, a walk, a five-minute warning before changes"
        />

        <YesNo
          id="sleep"
          question={`Does ${name} have trouble sleeping away from home?`}
          value={f.has_sleep_disturbance}
          onChange={setFlag('has_sleep_disturbance')}
        >
          <label className={label}>What should the night staff know?</label>
          <textarea className={input} rows={2} value={f.sleep_notes} onChange={set('sleep_notes')} />
        </YesNo>
      </Card>

      <Card n={4} title="Support at camp">
        <YesNo
          id="buddy"
          question={`Does ${name} need a one-to-one buddy?`}
          value={f.buddy_required}
          onChange={setFlag('buddy_required')}
        >
          <p className="mt-2 text-sm text-neutral-600">
            Noted. Buddy pairing is done by camp staff before the week starts.
          </p>
        </YesNo>

        <YesNo
          id="caregiver"
          question={`Will a caregiver be attending with ${name}?`}
          value={f.has_caregiver}
          onChange={setFlag('has_caregiver')}
        >
          <p className="mt-2 text-sm text-neutral-600">
            Make sure they are added to your registration as well, so they have a place and a
            meal.
          </p>
        </YesNo>
      </Card>

      <Card
        n={5}
        title="Emergency contact"
        subtitle="Someone we can reach during the event who is not attending it. This is the one part of the form we'd really like filled in."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Name</label>
            <input
              className={input}
              value={f.emergency_contact_name}
              onChange={set('emergency_contact_name')}
            />
          </div>
          <div>
            <label className={label}>Phone</label>
            <input
              type="tel"
              className={input}
              value={f.emergency_contact_phone}
              onChange={set('emergency_contact_phone')}
            />
          </div>
        </div>
        <label className={label}>Relationship to {name}</label>
        <input
          className={input}
          value={f.emergency_contact_relationship}
          onChange={set('emergency_contact_relationship')}
          placeholder="Mother, brother, support worker…"
        />
      </Card>

      <Card n={6} title="Anything else?" subtitle="Anything that doesn't fit neatly above.">
        <textarea
          className={input}
          rows={4}
          value={f.other_concerns}
          onChange={set('other_concerns')}
        />
      </Card>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 z-20 -mx-4 sm:mx-0 border-t border-neutral-200 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Wording matters here: "almost" nothing, because the emergency
              contact IS asked of everyone (soft-required in save()). */}
          <p className="text-sm text-neutral-600">
            Almost nothing here is required — we do ask everyone for an emergency
            contact. Come back and add to it any time.
          </p>
          <div className="flex items-center gap-4">
            <Link
              href={backHref}
              className="text-neutral-500 font-semibold hover:text-neutral-700 hover:underline"
            >
              {saved ? 'Back to dashboard' : 'Cancel'}
            </Link>
            {/* The button carries the state -- Save -> Saving... -> Saved,
                flipping back to Save when anything changes (set()/setFlag()
                clear `saved`). Testing found the old pattern -- a green
                "Saved" popping in beside a button that said "Save" again --
                read as ambiguous. */}
            <SaveButton
              busy={busy}
              saved={saved}
              onClick={save}
              label="Save details"
              className="!py-2"
            />
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-neutral-500 pb-2">
        Only camp staff who need it can see this — the same small group who handle medical and
        support information. It is never shown on rosters or shared outside the ministry.
      </p>
    </div>
  );
}
