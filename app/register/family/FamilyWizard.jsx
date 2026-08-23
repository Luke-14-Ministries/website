'use client';

// Family registration, as ONE scrolling page rather than a four-step
// click-through (CampSite moved the same way; a family filling this in on a
// phone can see the whole shape of what is being asked, scroll back to fix
// something, and never lose answers to a mis-tapped Back button).
//
// The old step machine is gone. What replaces it:
//   - numbered cards, each a section of the form
//   - a sticky summary bar with the running total and the submit button, so
//     "what will this cost / am I done" is always on screen
//   - validation reported against named sections instead of step numbers
//
// The DEEP support profile (medications, allergies, seizure and behaviour
// detail, emergency contact) is deliberately NOT here -- it lives in a
// per-person form the family completes after registering
// (/account/details/[personId]). Registration should take a few minutes and
// secure a place; the medical detail can follow before camp.

import { useState } from 'react';
import Link from 'next/link';
import { submitFamilyRegistration } from './actions';

const emptyMember = {
  personId: null,
  firstName: '',
  lastName: '',
  dob: '',
  sex: '',
  // Deliberately blank: role is a choice the family must make, not a default
  // we make for them -- especially since the old default ("Camper with
  // disability") was also the most sensitive answer on the form, and it stuck
  // silently to anyone who skipped the dropdown.
  role: '',
  tshirt: '',
  firstTime: '',
  needs: '',
  diet: '',
  // Permissions, not agreements: a family may say no to either of these and
  // still register. They start CHECKED, which is how the ministry has always
  // run them -- the CEO's account is that chasing individual permissions for a
  // small team is unmanageable, and that in practice a handful of families
  // have pushed back while the large majority are content. Unchecking is one
  // click and always honoured; the prompt asks them to reconsider once, and
  // then gets out of the way.
  mediaConsent: 'true',
  directoryConsent: 'true',
  // Set by the server when this person declined the same permission before.
  // The box still opens checked -- trust grows with attending, and a
  // permanently remembered refusal never lets a family change its mind -- but
  // the previous answer is shown so the change is a decision, not a slip.
  mediaWasNo: false,
  directoryWasNo: false,
};

// Shown once, when a family turns a permission OFF. Written to persuade
// honestly rather than to nag: it says what the cost actually is, and it says
// out loud that some families have good reason and will not be argued with.
// OK keeps the permission; Cancel turns it off.
const RECONSIDER = {
  mediaConsent: (who) =>
    `Photos are how the ministry shows people what camp is actually like — most of what you see on the website and in print came from a week like this one.\n\n` +
    `Unchecking tells us you'd rather we didn't feature ${who}, and we'll do our best to honour that. Some families have good reasons, and we'd much rather you tell us than not.\n\n` +
    `You can change your mind at any time, and if a particular photo ever concerns you, email info@luke14ministries.net and we'll work to sort it out promptly.\n\n` +
    `Would you like to leave photo permission on for ${who}?\n\n` +
    `OK = leave it on.  Cancel = tell us you'd rather we didn't.`,
  directoryConsent: (who) =>
    `The directory is how attending families find each other — it is the main way people connect before and after, and a lot of friendships have started there.\n\n` +
    `Leaving ${who} out means other families can't reach you.\n\n` +
    `Some families prefer to keep their details private, and that is entirely fine. Would you like to stay listed?\n\n` +
    `OK = stay listed.  Cancel = leave us out.`,
};

const TSHIRT_SIZES = [
  'Youth S', 'Youth M', 'Youth L',
  'Adult S', 'Adult M', 'Adult L', 'Adult XL', 'Adult 2XL', 'Adult 3XL',
];

// Kept as a short list rather than free text: CampSite's free-text version
// produced answers like "My Friend" that cannot be counted or reported on.
const HEARD_ABOUT = [
  'A friend or family member',
  'Our church',
  'Another church',
  'Social media',
  'Web search',
  'A Luke 14 staff member or volunteer',
  "We've been before",
  'Other',
];

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

// `existing` (from the server page) prefills the whole form when this account
// already has a registration -- so "Edit Registration" opens the saved answers,
// not a blank form. isUpdate flips the wording from Submit to Update.
export default function FamilyWizard({
  weeks,
  defaultEmail = '',
  existing = null,
  askHeardAbout = false,
  agreements = [],
  signedAlready = null,
}) {
  const isUpdate = existing?.isUpdate === true;
  // A signature is evidence with a date on it. If this household already
  // signed for this registration, the original stands and we do not ask again
  // -- we show what was signed and when, and offer a copy.
  const alreadySigned = Boolean(signedAlready?.signedAt);

  const [family, setFamily] = useState(
    existing?.family ?? {
      contactFirst: '',
      contactLast: '',
      email: defaultEmail,
      phone: '',
      address: '',
      church: '',
      heardAbout: '',
      heardAboutFrom: '',
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
  const [agreed, setAgreed] = useState(() => new Set());
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('self');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const week = weeks[weekIdx] ?? weeks[0];
  const named = members.filter((m) => m.firstName.trim() && m.lastName.trim());
  const namedCount = named.length;
  const total = (week?.feeCents ?? 0) * namedCount;

  const setF = (k) => (e) => setFamily({ ...family, [k]: e.target.value });
  const setM = (i, k) => (e) => {
    const next = members.map((m, j) => (j === i ? { ...m, [k]: e.target.value } : m));
    setMembers(next);
  };

  // Permission checkboxes. Turning one ON is instant; turning one OFF asks
  // once, and takes no for an answer.
  const setConsent = (i, k) => (e) => {
    const on = e.target.checked;
    if (!on) {
      const who = members[i]?.firstName?.trim() || 'this person';
      if (!window.confirm(RECONSIDER[k](who))) {
        setMembers(members.map((m, j) => (j === i ? { ...m, [k]: 'false' } : m)));
      }
      // Confirmed = they reconsidered and are keeping it on, so nothing to do.
      return;
    }
    setMembers(members.map((m, j) => (j === i ? { ...m, [k]: 'true' } : m)));
  };

  async function handleSubmit() {
    // HARD requirement: role. DOB and sex below are soft confirms, but a
    // missing role has no sensible fallback -- fees, rosters, and volunteer
    // review all key off it.
    const missingRole = named.filter((m) => !m.role);
    if (missingRole.length > 0) {
      const names = missingRole.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', ');
      setError(`Please choose a role for: ${names} — in “Who's coming” above.`);
      return;
    }
    // Soft requirement: date of birth. It is one of the ways family members
    // are told apart, so warn (but do not block) when it is missing.
    const missingDob = named.filter((m) => !m.dob);
    if (missingDob.length > 0) {
      const names = missingDob.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', ');
      const ok = window.confirm(
        `No date of birth entered for: ${names}.\n\nBirth dates help us tell family members apart, and help program leaders at camp plan resources and accommodations appropriately. Save anyway?`
      );
      if (!ok) return;
    }
    // Same soft requirement for sex: program leaders use it for volunteer
    // pairing, adult programming, and rooming assignments.
    const missingSex = named.filter((m) => !m.sex);
    if (missingSex.length > 0) {
      const names = missingSex.map((m) => `${m.firstName} ${m.lastName}`.trim()).join(', ');
      const ok = window.confirm(
        `Sex not selected for: ${names}.\n\nCamp leaders use this for rooming assignments, volunteer pairing, and program planning. Save anyway?`
      );
      if (!ok) return;
    }
    // HARD requirement: the agreements. These are conditions of attending, not
    // preferences -- so unlike the two permissions below, an unanswered one
    // stops the submit rather than saving as null.
    if (!alreadySigned && agreements.length > 0) {
      const unchecked = agreements.filter((a) => !agreed.has(a.key));
      if (unchecked.length > 0) {
        setError(
          `Please read and agree to: ${unchecked.map((a) => a.title).join(', ')} — in “Agreements & permissions” below.`
        );
        return;
      }
      if (!signerName.trim()) {
        setError('Please type your full name as your signature at the bottom of “Agreements & permissions”.');
        return;
      }
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
        agreements: alreadySigned
          ? null
          : {
              signerName: signerName.trim(),
              signerRole,
              keys: agreements.map((a) => a.key),
            },
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
            : 'Camp staff will review your registration and follow up.'}
        </p>
        <p className="mt-3 text-neutral-700">
          <strong>One more thing before camp:</strong> each person attending has a short
          details form — allergies, medications, support needs and an emergency
          contact. You&rsquo;ll find a link for each of them on your dashboard, and you
          can fill them in whenever suits.
        </p>
        {result.signed > 0 && (
          <p className="mt-3 text-neutral-700">
            Your signed agreements are saved.{' '}
            <Link href="/account/agreements/" className="text-brand underline font-semibold">
              View or print a copy
            </Link>{' '}
            any time.
          </p>
        )}
        <Link href="/account/dashboard/" className="btn-primary mt-6">
          Go to My Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1 — what they're registering for. First, because it sets the price. */}
      <Card
        n={1}
        title="What you're registering for"
        subtitle={
          weeks.length === 1
            ? 'One session is open for registration right now.'
            : 'Choose the session your family is attending.'
        }
      >
        <div className="space-y-2">
          {weeks.map((w, i) => (
            <label
              key={w.optionId}
              className="flex items-center justify-between gap-3 rounded border border-neutral-300 p-3 cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand-light"
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="week"
                  checked={weekIdx === i}
                  onChange={() => setWeekIdx(i)}
                />
                <span className="font-semibold">{fmtWeek(w)}</span>
              </span>
              <span className="text-sm text-neutral-600 shrink-0">
                {money(w.feeCents)}/person
              </span>
            </label>
          ))}
        </div>
      </Card>

      {/* 2 — the family's own details. */}
      <Card
        n={2}
        title="Your family"
        subtitle="We've filled in what we know from your account. The primary contact is who camp staff will call or email about this registration — if that should be someone else, just change the details below."
      >
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

        {/* Asked once per family, never again -- the server only sends
            askHeardAbout when this household has no answer on file. */}
        {askHeardAbout && (
          <>
            <label className={label}>How did you hear about Luke 14 Ministries?</label>
            <select className={input} value={family.heardAbout} onChange={setF('heardAbout')}>
              <option value="">— select —</option>
              {HEARD_ABOUT.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
            {family.heardAbout && (
              <>
                <label className={label}>
                  Anyone we should thank, or anything to add? (optional)
                </label>
                <input
                  className={input}
                  value={family.heardAboutFrom}
                  onChange={setF('heardAboutFrom')}
                  placeholder="e.g. the Smiths, or First Baptist"
                />
              </>
            )}
          </>
        )}
      </Card>

      {/* 3 — the people. */}
      <Card
        n={3}
        title="Who's coming"
        subtitle="Everyone attending — including yourself if you're coming. Each person gets their own place and fee."
      >
        <div className="space-y-6">
          {members.map((m, i) => (
            <div key={i} className="rounded border border-neutral-200 p-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold">
                  {m.firstName.trim() || m.lastName.trim()
                    ? `${m.firstName} ${m.lastName}`.trim()
                    : `Person ${i + 1}`}
                </h3>
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
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className={label}>Date of birth</label>
                  <input type="date" className={input} value={m.dob} onChange={setM(i, 'dob')} />
                </div>
                <div>
                  <label className={label}>Sex</label>
                  <select className={input} value={m.sex} onChange={setM(i, 'sex')}>
                    <option value="">— select —</option>
                    <option>Male</option>
                    <option>Female</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Role</label>
                  <select className={input} value={m.role} onChange={setM(i, 'role')}>
                    <option value="" disabled>
                      Choose a role…
                    </option>
                    <option>Camper with disability</option>
                    <option>Parent/Guardian</option>
                    <option>Sibling</option>
                    <option>Caregiver</option>
                    <option>Volunteer</option>
                  </select>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className={label}>T-shirt size</label>
                  <select className={input} value={m.tshirt} onChange={setM(i, 'tshirt')}>
                    <option value="">— select —</option>
                    {TSHIRT_SIZES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>First time at a Luke 14 event?</label>
                  <select className={input} value={m.firstTime} onChange={setM(i, 'firstTime')}>
                    <option value="">— select —</option>
                    <option value="true">Yes — first time</option>
                    <option value="false">No — been before</option>
                  </select>
                </div>
              </div>
              <label className={label}>
                Disability / support needs — the short version
              </label>
              <textarea className={input} rows={2} value={m.needs} onChange={setM(i, 'needs')} />
              <label className={label}>Dietary needs / allergies — the short version</label>
              <input className={input} value={m.diet} onChange={setM(i, 'diet')} />

              {/* Permissions live with the PERSON they are about, and each is
                  free to be "no" without affecting the registration. */}
              <div className="mt-4 space-y-3 rounded bg-neutral-50 p-4">
                <p className="text-sm font-semibold text-neutral-700">
                  Permissions for {m.firstName.trim() || 'this person'}
                </p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={m.mediaConsent === 'true'}
                    onChange={setConsent(i, 'mediaConsent')}
                  />
                  <span className="text-sm">
                    <span className="font-semibold">Photos and videos.</span> We may feature{' '}
                    {m.firstName.trim() || 'this person'} in material we publish — our
                    website, social media, printed pieces.
                    {/* Deliberately worded as a PREFERENCE we will work hard to
                        honour, not a guarantee we can enforce. Luke 14 has two
                        paid staff and runs on volunteers, and a week of camp
                        produces thousands of frames; promising that a named
                        person will never appear anywhere is a promise the
                        ministry cannot keep. Naming the route for a specific
                        concern is worth more than a broad assurance. */}
                    <span className="block mt-1 text-xs text-neutral-500">
                      Unchecking tells us you&rsquo;d rather we didn&rsquo;t, and
                      we&rsquo;ll do our best to honour that. Being straight with you
                      about the limits: this is about not <em>featuring</em> someone as
                      the subject of a picture, and with a small team and thousands of
                      photos in a week we can&rsquo;t promise nobody ever appears in a
                      wide group or whole-camp shot. If you see something you&rsquo;re
                      not comfortable with, email{' '}
                      <span className="font-semibold">info@luke14ministries.net</span> and
                      we&rsquo;ll work to address it promptly.
                    </span>
                    {m.mediaWasNo && m.mediaConsent === 'true' && (
                      <span className="mt-1 block rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-900">
                        Last time you told us you&rsquo;d rather we didn&rsquo;t. We ask
                        again each year in case you feel differently now — uncheck if
                        your preference hasn&rsquo;t changed.
                      </span>
                    )}
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={m.directoryConsent === 'true'}
                    onChange={setConsent(i, 'directoryConsent')}
                  />
                  <span className="text-sm">
                    <span className="font-semibold">Participant directory.</span> Include{' '}
                    {m.firstName.trim() || 'this person'} in the list shared with the other
                    families attending.
                    <span className="block mt-1 text-xs text-neutral-500">
                      It&rsquo;s how families connect before and after. Uncheck to be left
                      out — nothing else about your registration changes.
                    </span>
                    {m.directoryWasNo && m.directoryConsent === 'true' && (
                      <span className="mt-1 block rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-900">
                        Last time you asked to be left out. We ask again each year in
                        case you feel differently now — uncheck if your answer
                        hasn&rsquo;t changed.
                      </span>
                    )}
                  </span>
                </label>
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                A fuller form for {m.firstName.trim() || 'this person'} — medications,
                allergy detail, what helps on a hard day, emergency contact — appears on
                your dashboard after you {isUpdate ? 'update' : 'submit'}.
              </p>
            </div>
          ))}
          <button
            type="button"
            className="btn-outline !py-2"
            onClick={() => setMembers([...members, { ...emptyMember }])}
          >
            + Add another person
          </button>
        </div>
      </Card>

      {/* 4 — free text. */}
      <Card
        n={4}
        title="Anything else?"
        subtitle="Optional — anything that doesn't fit neatly above."
      >
        <textarea
          className={input}
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Card>

      {/* 5 — the agreements, signed once for the whole family. */}
      {agreements.length > 0 && (
        <Card
          n={5}
          title="Agreements"
          subtitle={
            alreadySigned
              ? 'Already signed for this registration — nothing to do here.'
              : 'Please read each one. Your typed name at the bottom signs all of them, for everyone listed above.'
          }
        >
          {alreadySigned ? (
            <div className="rounded border border-green-300 bg-green-50 px-4 py-3">
              <p className="text-green-900">
                Signed by <strong>{signedAlready.signerName}</strong> on{' '}
                {new Date(signedAlready.signedAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                .
              </p>
              <p className="mt-1 text-sm text-green-800">
                Signatures aren&rsquo;t re-taken when you update a registration — the
                date on a release is part of the record.{' '}
                <Link href="/account/agreements/" className="underline font-semibold">
                  View or print your copy
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {agreements.map((a) => (
                  <label
                    key={a.key}
                    className="block rounded border border-neutral-300 p-4 cursor-pointer has-[:checked]:border-brand has-[:checked]:bg-brand-light"
                  >
                    <span className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0"
                        checked={agreed.has(a.key)}
                        onChange={(e) => {
                          const next = new Set(agreed);
                          if (e.target.checked) next.add(a.key);
                          else next.delete(a.key);
                          setAgreed(next);
                        }}
                      />
                      <span>
                        <span className="block font-bold">{a.title}</span>
                        <span className="mt-1 block text-sm text-neutral-700">{a.body}</span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-6 rounded border border-neutral-300 bg-neutral-50 p-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className={label}>Type your full name to sign</label>
                    <input
                      className={`${input} font-serif italic text-lg`}
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="Your full name"
                      autoComplete="name"
                    />
                  </div>
                  <div>
                    <label className={label}>I am signing</label>
                    <select
                      className={input}
                      value={signerRole}
                      onChange={(e) => setSignerRole(e.target.value)}
                    >
                      <option value="self">for myself</option>
                      <option value="parent">as a parent</option>
                      <option value="guardian">as a legal guardian</option>
                    </select>
                  </div>
                </div>
                <p className="mt-3 text-xs text-neutral-600">
                  Dated {new Date().toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  . Typing your name here has the same effect as signing on paper. We
                  record which version of each agreement you signed, so you can always
                  see the exact wording you agreed to — a copy is available on your
                  dashboard afterwards.
                </p>
              </div>
            </>
          )}
        </Card>
      )}

      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-4 py-3 text-red-800"
        >
          {error}
        </p>
      )}

      {/* The running total and the way out, pinned to the bottom of the
          viewport so a long scroll never hides either. */}
      <div className="sticky bottom-0 z-20 -mx-4 sm:mx-0 border-t border-neutral-200 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-bold">
              {namedCount === 0
                ? 'No one added yet'
                : `${namedCount} ${namedCount === 1 ? 'person' : 'people'} · ${money(total)}`}
            </p>
            <p className="text-xs text-neutral-500">
              {week ? fmtWeek(week) : 'Choose a session above'} · payment happens on your
              dashboard afterwards
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/account/dashboard/"
              title="Leave without saving changes"
              className="text-neutral-500 font-semibold hover:text-neutral-700 hover:underline"
            >
              Cancel
            </Link>
            <button
              type="button"
              className="btn-gold !py-2 disabled:opacity-50"
              disabled={busy || namedCount === 0}
              title={namedCount === 0 ? 'Add at least one person first' : undefined}
              onClick={handleSubmit}
            >
              {busy ? 'Saving…' : isUpdate ? 'Update Registration' : 'Submit Registration'}
            </button>
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-neutral-500 pb-2">
        Scholarships are available — ask at camp@luke14ministries.net.
        {isUpdate
          ? ' Updating replaces your saved answers for this session; people are matched by name and date of birth, so nobody is duplicated.'
          : ''}
      </p>
    </div>
  );
}
