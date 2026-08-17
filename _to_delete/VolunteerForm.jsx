'use client';

import { useState } from 'react';
import Link from 'next/link';

const weeks = [
  'Week 1: July 19–24, 2026 (volunteers arrive Sunday)',
  'Week 2: July 26–31, 2026 (volunteers arrive Sunday)',
  'Both weeks',
];

const roles = [
  'Buddy (one-on-one with a camper)',
  'Children/Youth programs',
  'Kitchen & meals',
  'Music & worship',
  'Recreation & activities',
  'Media & photography',
  'Wherever I am needed most',
];

const input = 'w-full rounded border border-neutral-300 px-4 py-2.5';
const label = 'block font-semibold mb-1.5 mt-4 first:mt-0';

export default function VolunteerForm() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    age: '',
    church: '',
    week: weeks[0],
    experience: '',
    agree: false,
  });
  const [picked, setPicked] = useState([]);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  if (done) {
    return (
      <div className="rounded-lg border-2 border-brand bg-brand-light p-8 text-center">
        <h2 className="text-2xl font-bold text-brand-dark">
          Application submitted (preview only)
        </h2>
        <p className="mt-3 text-lg">
          In the live version this saves your application, emails you the
          volunteer training details and background-check paperwork, and takes
          you to secure payment of the $495/week volunteer fee through Stripe.
        </p>
        <Link href="/account/dashboard" className="btn-primary mt-6">
          View Sample Dashboard
        </Link>
      </div>
    );
  }

  return (
    <form
      className="rounded-lg border border-neutral-200 shadow bg-white p-6 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(true);
      }}
    >
      <label className={label}>Full name</label>
      <input required className={input} value={form.name} onChange={set('name')} />
      <div className="grid sm:grid-cols-2 gap-4 mt-0">
        <div>
          <label className={label}>Email</label>
          <input type="email" required className={input} value={form.email} onChange={set('email')} />
        </div>
        <div>
          <label className={label}>Phone</label>
          <input type="tel" className={input} value={form.phone} onChange={set('phone')} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={label}>Age</label>
          <input type="number" min="14" className={input} value={form.age} onChange={set('age')} />
        </div>
        <div>
          <label className={label}>Home church (optional)</label>
          <input className={input} value={form.church} onChange={set('church')} />
        </div>
      </div>

      <label className={label}>Which week?</label>
      <select className={input} value={form.week} onChange={set('week')}>
        {weeks.map((w) => (
          <option key={w}>{w}</option>
        ))}
      </select>

      <label className={label}>Where would you like to serve?</label>
      <div className="grid sm:grid-cols-2 gap-2 mt-1">
        {roles.map((r) => (
          <label key={r} className="flex items-center gap-2 rounded border border-neutral-200 px-3 py-2 cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand-light text-sm">
            <input
              type="checkbox"
              checked={picked.includes(r)}
              onChange={() =>
                setPicked(
                  picked.includes(r)
                    ? picked.filter((x) => x !== r)
                    : [...picked, r]
                )
              }
            />
            {r}
          </label>
        ))}
      </div>

      <label className={label}>
        Tell us about any experience with disability ministry (optional)
      </label>
      <textarea className={input} rows={3} value={form.experience} onChange={set('experience')} />

      <label className="flex items-start gap-3 mt-6 cursor-pointer">
        <input
          type="checkbox"
          required
          checked={form.agree}
          onChange={(e) => setForm({ ...form, agree: e.target.checked })}
          className="mt-1"
        />
        <span className="text-sm text-neutral-700">
          I understand that volunteers must complete training before camp and
          consent to a background check (adults 18+). Volunteer fee is
          $495/week (covers lodging and meals).
        </span>
      </label>

      <button type="submit" className="btn-primary w-full mt-6">
        Submit Application &amp; Continue to Payment
      </button>
      <p className="mt-3 text-xs text-neutral-400 text-center">
        Preview build — nothing is saved or charged.
      </p>
    </form>
  );
}
