'use client';

// The family's own editor: household contact info, per-person details, and
// two caregiver links per person. Saves are per-card so a family can fix one
// thing quickly. Suggested caregivers default to the household's
// parents/guardians but stay fully editable.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateHouseholdInfo, updatePersonInfo, setCaregivers } from './actions';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded border border-neutral-300 px-3 py-2';

export default function HouseholdManager({ household, members, caregiversByPerson }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [msg, setMsg] = useState({});

  function run(key, fn) {
    setMsg((m) => ({ ...m, [key]: 'saving' }));
    start(async () => {
      const res = await fn();
      setMsg((m) => ({ ...m, [key]: res.ok ? 'saved' : res.error }));
      router.refresh();
    });
  }

  const Status = ({ k }) =>
    msg[k] && msg[k] !== 'saving' ? (
      <span className={`text-sm ${msg[k] === 'saved' ? 'text-green-700' : 'text-red-700'}`}>
        {msg[k] === 'saved' ? 'Saved ✓' : msg[k]}
      </span>
    ) : msg[k] === 'saving' ? (
      <span className="text-sm text-neutral-500">Saving…</span>
    ) : null;

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
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          run('hh', () => updateHouseholdInfo(household.id, f));
        }}
      >
        <h2 className="text-lg font-bold mb-4">Household contact info</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Family / household name">
            <input name="display_name" defaultValue={household?.display_name ?? ''} className={inputCls} />
          </Field>
          <Field label="Main phone">
            <input name="phone" type="tel" defaultValue={household?.phone ?? ''} className={inputCls} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" defaultValue={household?.email ?? ''} className={inputCls} />
          </Field>
          <Field label="Street address">
            <input name="address_line1" defaultValue={household?.address_line1 ?? ''} className={inputCls} />
          </Field>
          <Field label="City">
            <input name="city" defaultValue={household?.city ?? ''} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State">
              <input name="state" defaultValue={household?.state ?? ''} className={inputCls} />
            </Field>
            <Field label="ZIP">
              <input name="postal_code" defaultValue={household?.postal_code ?? ''} className={inputCls} />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" className="btn-primary !py-2">Save household info</button>
          <Status k="hh" />
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
            <h2 className="text-lg font-bold mb-1">
              {m.first_name} {m.last_name}
              <span className="font-normal text-neutral-500 text-base">
                {m.age != null ? ` · age ${m.age}` : ' · no date of birth on file'}
              </span>
            </h2>
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
              <Field label={isAdult ? 'Phone' : 'Phone (if they carry one)'}>
                <input name="phone" type="tel" defaultValue={m.phone ?? ''} className={inputCls} />
              </Field>
              <Field label="Email (optional)">
                <input name="email" type="email" defaultValue={m.email ?? ''} className={inputCls} />
              </Field>
            </div>

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
                    defaultValue={slot === 1 ? cg1 : cg2}
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
                Who staff contact first about this person at camp. Make sure each caregiver&rsquo;s
                phone number is provided so staff have a way to reach them if needed during camp.
              </p>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button type="submit" className="btn-primary !py-2">Save</button>
              <Status k={m.id} />
            </div>
          </form>
        );
      })}

      <p className="text-sm text-neutral-500">
        Need to add or remove a family member? That happens through a{' '}
        <a href="/register/family/" className="text-brand font-semibold">registration</a>, or by
        contacting the ministry.
      </p>
    </div>
  );
}
