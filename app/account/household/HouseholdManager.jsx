'use client';

// The family's own editor: household contact info, per-person details, and
// two caregiver links per person. Saves are per-card so a family can fix one
// thing quickly. Suggested caregivers default to the household's
// parents/guardians but stay fully editable.
//
// Save buttons follow the ONE platform pattern (SaveButton: Save -> Saving…
// -> Saved ✓, flipping back to Save when the card changes). This page kept
// its own older style for a day; the 24 Aug review asked the obvious
// question -- why not be as consistent as possible across the platform? --
// and there was no good answer. Now it matches the details form and the
// staff editors. Errors still print beside the button in red.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import SaveButton from '@/components/SaveButton';
import PhotoUpload from '@/components/PhotoUpload';
import { formatPhone, formatZip, tidyCity, US_STATES } from '@/lib/format';
import {
  updateHouseholdInfo,
  updatePersonInfo,
  setCaregivers,
  addHouseholdPerson,
  removeHouseholdPerson,
} from './actions';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded border border-neutral-300 px-3 py-2';

export default function HouseholdManager({
  household,
  members,
  caregiversByPerson,
  photoUrlByPerson = {},
}) {
  const router = useRouter();
  const [, start] = useTransition();
  // Per-card save state, keyed by card ('hh' or a person id):
  // { busy, saved, error }. Typing in a card clears its `saved`, which flips
  // the button back to plain "Save" -- same behavior as the details form.
  const [state, setState] = useState({});
  // Per-person override for the caregiver section: undefined = use the
  // default rule, true = the person asked to see it.
  const [caregiversOpen, setCaregiversOpen] = useState({});
  const patch = (key, s) => setState((m) => ({ ...m, [key]: { ...m[key], ...s } }));

  function run(key, fn) {
    patch(key, { busy: true, saved: false, error: '' });
    start(async () => {
      const res = await fn();
      patch(key, { busy: false, saved: !!res.ok, error: res.ok ? '' : res.error });
      router.refresh();
    });
  }

  // Uncontrolled inputs, so dirty-tracking listens at the form: any input
  // event inside the card means it no longer matches what was saved.
  const markDirty = (key) => () => patch(key, { saved: false });

  // Fields tidy themselves on blur, exactly like the wizard's -- same helpers,
  // same rule (only reformat what is unambiguously the expected shape).
  const tidyPhone = (e) => {
    e.target.value = formatPhone(e.target.value);
  };
  const tidyZip = (e) => {
    e.target.value = formatZip(e.target.value);
  };
  const tidyTown = (e) => {
    e.target.value = tidyCity(e.target.value);
  };

  // Suggested caregivers: household members who have served as parent/guardian,
  // else adults (18+). Used only when a person has no saved caregivers yet.
  const suggested = members.filter((m) => m.isGuardian);
  const fallbackAdults = members.filter((m) => m.age != null && m.age >= 18);
  const defaults = (suggested.length > 0 ? suggested : fallbackAdults).slice(0, 2);

  return (
    <div className="space-y-6">
      {/* Household contact card */}
      <form
        className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6"
        onInput={markDirty('hh')}
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          run('hh', () => updateHouseholdInfo(household.id, f));
        }}
      >
        <h2 className="text-lg font-bold mb-1">Household contact info</h2>
        {/* Three different things used to blur into one another here, and
            testing caught it: naming a new primary contact renamed the whole
            HOUSEHOLD, while My Household still listed the old person. They
            are now separate fields with separate meanings, labelled so the
            difference is visible rather than implied. */}
        <p className="text-sm text-neutral-600 mb-4">
          The <strong>family name</strong> is what staff see on a roster. The{' '}
          <strong>primary contact</strong> is the person they call. They don&rsquo;t have to
          match.
        </p>
        {/* Said explicitly because the two cards look alike: a household phone
            and a person phone are different things, and when the family name
            happens to match a person's name (the usual case for a household of
            one) they read as duplicates of each other. Testing hit exactly
            this, 25 Aug. */}
        <p className="mb-4 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
          This section is about the <strong>household</strong> — the phone and email camp
          staff use to reach your family, and where post is sent. Each person&rsquo;s own
          phone and email live on their card further down, and are only used if staff need
          that person directly.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Family / household name">
            <input name="display_name" defaultValue={household?.display_name ?? ''} className={inputCls} />
            <span className="mt-1 block text-xs text-neutral-500">
              e.g. &ldquo;{(members[0]?.last_name || 'Smith')} family&rdquo;
            </span>
          </Field>
          <Field label="Primary contact">
            <select
              name="primary_contact_person_id"
              defaultValue={household?.primary_contact_person_id ?? ''}
              className={inputCls}
            >
              <option value="">— not set —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-neutral-500">
              Whoever camp staff should call first. Only people in your household appear
              here — add someone through a registration.
            </span>
          </Field>
          <Field label="Main phone">
            <input
              name="phone"
              type="tel"
              defaultValue={household?.phone ?? ''}
              onBlur={tidyPhone}
              className={inputCls}
            />
          </Field>
          <Field label="Email">
            <input name="email" type="email" defaultValue={household?.email ?? ''} className={inputCls} />
          </Field>
          <Field label="Street address">
            <input name="address_line1" defaultValue={household?.address_line1 ?? ''} className={inputCls} />
          </Field>
          <Field label="City">
            <input
              name="city"
              defaultValue={household?.city ?? ''}
              onBlur={tidyTown}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            {/* A dropdown, not a text box (24 Aug): it makes the single most
                common bad address value -- a missing or invented state --
                impossible to enter, at no cost and with no third-party
                lookup service involved. */}
            <Field label="State">
              <select name="state" defaultValue={household?.state ?? ''} className={inputCls}>
                <option value="">—</option>
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code} title={name}>
                    {code}
                  </option>
                ))}
                {household?.state && !US_STATES.some(([c]) => c === household.state) && (
                  <option value={household.state}>{household.state}</option>
                )}
              </select>
            </Field>
            <Field label="ZIP">
              <input
                name="postal_code"
                defaultValue={household?.postal_code ?? ''}
                onBlur={tidyZip}
                inputMode="numeric"
                className={inputCls}
              />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SaveButton
            type="submit"
            busy={state.hh?.busy}
            saved={state.hh?.saved}
            label="Save household info"
            className="!py-2"
          />
          {state.hh?.error && <span className="text-sm text-red-700">{state.hh.error}</span>}
        </div>
      </form>

      {/* One card per person */}
      {members.map((m) => {
        const saved = caregiversByPerson[m.id] ?? {};
        const hasSaved = saved[1] || saved[2];
        const cg1 = saved[1] ?? (hasSaved ? '' : defaults[0]?.id ?? '');
        const cg2 = saved[2] ?? (hasSaved ? '' : defaults[1]?.id ?? '');
        const others = members.filter((o) => o.id !== m.id);
        const isAdult = m.age != null && m.age >= 18;
        return (
          <form
            key={m.id}
            className="rounded-lg bg-white border border-neutral-200 shadow-sm p-6"
            onInput={markDirty(m.id)}
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              run(m.id, async () => {
                const r1 = await updatePersonInfo(m.id, f);
                if (!r1.ok) return r1;
                return setCaregivers(m.id, f.caregiver1 || null, f.caregiver2 || null);
              });
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Person
            </p>
            <h2 className="text-lg font-bold mb-1">
              {m.first_name} {m.last_name}
              <span className="font-normal text-neutral-500 text-base">
                {m.age != null ? ` · age ${m.age}` : ' · no date of birth on file'}
              </span>
            </h2>
            {/* The photo lives here as well as on the details form (asked for
                25 Aug). It is a household fact — "who is this person" — not an
                event one, and a family keeping their roster current should not
                have to open a per-event form to change a face. Same component,
                same storage path, so a photo added in either place is the
                same photo. */}
            <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-4">
              <PhotoUpload
                personId={m.id}
                personName={m.first_name}
                initialUrl={photoUrlByPerson[m.id] ?? null}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 mt-3">
              <Field label="First name">
                <input name="first_name" defaultValue={m.first_name ?? ''} className={inputCls} />
              </Field>
              <Field label="Last name">
                <input name="last_name" defaultValue={m.last_name ?? ''} className={inputCls} />
              </Field>
              <Field label="Date of birth">
                <input name="date_of_birth" type="date" defaultValue={m.date_of_birth ?? ''} className={inputCls} />
              </Field>
              <Field label="Sex">
                <select name="gender" defaultValue={m.gender ?? ''} className={inputCls}>
                  <option value="">— select —</option>
                  <option>Male</option>
                  <option>Female</option>
                  {m.gender && !['Male', 'Female'].includes(m.gender) && <option>{m.gender}</option>}
                </select>
              </Field>
              <Field label={isAdult ? 'Phone' : 'Phone (if they carry one)'}>
                <input
                  name="phone"
                  type="tel"
                  defaultValue={m.phone ?? ''}
                  onBlur={tidyPhone}
                  className={inputCls}
                />
              </Field>
              <Field label="Email (optional)">
                <input name="email" type="email" defaultValue={m.email ?? ''} className={inputCls} />
              </Field>
            </div>

            {/* WHO SEES THIS, AND WHY IT IS FOLDED AWAY.
                Lawrence, 25 Aug: non-standard arrangements should stay
                possible — so nothing here is restricted, and anyone in the
                household can still be chosen. What struck him as odd was
                merely being ASKED, on the card of the adult who is plainly
                the head of the house.
                
                So the field is not removed, it is folded: an independent
                adult with nothing saved sees a quiet link. A person who has
                caregivers saved, or who is a minor, sees them open.
                
                The inputs are NOT RENDERED while folded, deliberately. They
                are uncontrolled selects carrying suggested defaults, so
                leaving them mounted-but-hidden would submit a suggestion
                nobody confirmed — which is how DoubleFaci ended up looking
                like a saved answer. Absent means absent. */}
            {caregiversOpen[m.id] ?? (hasSaved || !isAdult) ? (
              <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-semibold mb-2">
                  Linked caregivers
                  {!hasSaved && defaults.length > 0 && (
                    <span className="font-normal text-neutral-500"> (suggested — save to confirm)</span>
                  )}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[1, 2].map((slot) => (
                    <select
                      key={slot}
                      name={`caregiver${slot}`}
                      defaultValue={
                        // Suggestions are for people who plausibly need one.
                        // An adult opening this by choice starts blank rather
                        // than being handed a guess to accept by accident.
                        isAdult && !hasSaved ? '' : slot === 1 ? cg1 : cg2
                      }
                      className={inputCls}
                    >
                      <option value="">— none —</option>
                      {others.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.first_name} {o.last_name}
                          {o.phone ? ` (${o.phone})` : ''}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
                <p className="text-xs text-neutral-500 mt-2">
                  Who staff contact first about this person at camp. Make sure each
                  caregiver&rsquo;s phone number is provided so staff have a way to reach them
                  if needed during camp.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCaregiversOpen((o) => ({ ...o, [m.id]: true }))}
                className="mt-4 text-sm text-brand underline"
              >
                Add a linked caregiver for {m.first_name}
              </button>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <SaveButton
                type="submit"
                busy={state[m.id]?.busy}
                saved={state[m.id]?.saved}
                className="!py-2"
              />
              {/* Removal is quiet and to the side -- it is the rare action,
                  and the server refuses it for anyone on a registration or
                  serving as the primary contact, explaining why. */}
              <button
                type="button"
                disabled={state[m.id]?.busy}
                onClick={() => {
                  const ok = window.confirm(
                    `Remove ${m.first_name} ${m.last_name} from your household?\n\n` +
                      `This only works for someone who has never been registered for an event.`
                  );
                  if (!ok) return;
                  run(m.id, () => removeHouseholdPerson(m.id));
                }}
                className="text-sm text-neutral-500 underline hover:text-red-700 disabled:opacity-50"
              >
                Remove from household
              </button>
              {state[m.id]?.error && (
                <span className="text-sm text-red-700">{state[m.id].error}</span>
              )}
            </div>
          </form>
        );
      })}

      {/* Add someone without registering them for anything (24 Aug). The old
          rule -- people only exist once they've been typed into a
          registration -- put the family's own roster behind an event, and
          meant re-typing the same children every year. Now the household is
          kept up to date here and people are PICKED at registration. */}
      <form
        className="rounded-lg border-2 border-dashed border-neutral-300 bg-white p-6"
        onInput={markDirty('add')}
        onSubmit={(e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          const f = Object.fromEntries(new FormData(formEl));
          run('add', async () => {
            const res = await addHouseholdPerson(household.id, f);
            if (res.ok) formEl.reset();
            return res;
          });
        }}
      >
        <h2 className="text-lg font-bold mb-1">Add a family member</h2>
        <p className="text-sm text-neutral-600 mb-4">
          Anyone in your family can live here whether or not they&rsquo;re attending
          something — then you just tick them when you register, instead of typing
          them in again.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input name="first_name" className={inputCls} required />
          </Field>
          <Field label="Last name">
            <input
              name="last_name"
              className={inputCls}
              defaultValue={members[0]?.last_name ?? ''}
              required
            />
          </Field>
          <Field label="Date of birth">
            <input name="date_of_birth" type="date" className={inputCls} />
          </Field>
          <Field label="Sex">
            <select name="gender" className={inputCls} defaultValue="">
              <option value="">— select —</option>
              <option>Male</option>
              <option>Female</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <SaveButton
            type="submit"
            busy={state.add?.busy}
            saved={state.add?.saved}
            label="Add to my household"
            className="!py-2"
          />
          {state.add?.error && <span className="text-sm text-red-700">{state.add.error}</span>}
          {state.add?.saved && (
            <span className="text-sm text-green-700">Added — they&rsquo;re in the list above.</span>
          )}
        </div>
      </form>

      <p className="text-sm text-neutral-500">
        Someone already on a registration can&rsquo;t be removed here — contact the
        ministry and staff will cancel their place properly, so the roster and any
        fees stay correct.
      </p>
    </div>
  );
}
