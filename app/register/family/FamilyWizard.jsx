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
import {
  formatPhone,
  formatZip,
  zipLooksValid,
  tidyCity,
  US_STATES,
  emailLooksValid,
} from '@/lib/format';
import { submitFamilyRegistration } from './actions';

const emptyMember = {
  personId: null,
  firstName: '',
  preferredName: '',
  lastName: '',
  dob: '',
  sex: '',
  // Deliberately blank: role is a choice the family must make, not a default
  // we make for them -- especially since the old default ("Camper with
  // disability") was also the most sensitive answer on the form, and it stuck
  // silently to anyone who skipped the dropdown.
  role: '',
  alsoVolunteering: false,
  tshirt: '',
  firstTime: '',
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
    // "Would you be willing" rather than "would you like" -- they have just
    // told us what they'd like by unchecking; the question being asked is
    // whether they are willing to reconsider (wording flagged 24 Aug).
    `Would you be willing to leave photo permission on for ${who}?\n\n` +
    `OK = leave it on.  Cancel = tell us you'd rather we didn't.`,
  directoryConsent: (who) =>
    `The directory is how attending families find each other — it is the main way people connect before and after, and a lot of friendships have started there.\n\n` +
    `Households appear as one combined entry with the adults' contact details — children are never listed individually.\n\n` +
    `Leaving ${who} out means other families can't reach you. Some families prefer to keep their details private, and that is entirely fine. Would you be willing to stay listed?\n\n` +
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

// Age on a given day, from two ISO date strings. Parsed by parts, like
// fmtWeek above, because `new Date('2019-06-12')` is UTC midnight and can
// read as the day before in a US timezone -- which would put a child born on
// the 1st a day the wrong side of their eighteenth birthday.
const ageOn = (dobISO, onISO) => {
  if (!dobISO) return null;
  const [by, bm, bd] = String(dobISO).split('-').map(Number);
  if (!by || !bm || !bd) return null;
  let y, m, d;
  if (onISO && String(onISO).includes('-')) {
    [y, m, d] = String(onISO).split('-').map(Number);
  } else {
    const t = new Date();
    [y, m, d] = [t.getFullYear(), t.getMonth() + 1, t.getDate()];
  }
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
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
  // Everyone already saved in this household, whether or not they have ever
  // registered. Offered as one-click adds so a family keeps its roster once
  // and picks from it, rather than retyping the same children every year.
  householdPeople = [],
  // Weeks this household already has a registration for. Used only to warn:
  // starting a NEW registration no longer inherits another week's people
  // (25 Aug), so the family needs telling when the week they just picked is
  // one they are already on.
  existingEvents = [],
}) {
  const isUpdate = existing?.isUpdate === true;
  // A signature is evidence with a date on it. If this household already
  // signed for this registration, the original stands and we do not ask again
  // -- we show what was signed and when, and offer a copy.


  const [family, setFamily] = useState(
    existing?.family ?? {
      contactFirst: '',
      contactLast: '',
      email: defaultEmail,
      phone: '',
      // The address is four fields, not one (24 Aug). It used to be a single
      // free-text box, which meant the whole thing landed in address_line1 and
      // the household's city/state/ZIP columns stayed empty -- unusable for a
      // mailing label and impossible to check for typos. Separate fields make
      // both possible.
      address: '',
      city: '',
      state: '',
      postalCode: '',
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
  // Replaced the capacity radio (25 Aug). "Myself and my household" versus
  // "adults I am the legal guardian for" was still not clear to the person
  // signing -- twice rewritten and twice reported -- and the reason is that it
  // asked for a legal category when what the release needs is a plain claim
  // about THESE people. Lawrence's wording: the signature covers everyone
  // listed above, and the signer states they are able to give it.
  const [coversAll, setCoversAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const week = weeks[weekIdx] ?? weeks[0];

  // The capacity a signature is given in is only a QUESTION when the answer
  // is not already on the form. Testing, 25 Aug: a registration containing a
  // seven-year-old recorded its release as signed "for themselves", because
  // the capacity defaulted to 'self' and nobody had reason to change it.
  //
  // If anyone on this registration is under 18, the capacity is settled --
  // an adult signing a release covering a child is signing as their parent
  // or legal guardian, and the form should say so rather than offer a choice
  // it already knows the answer to.
  //
  // When everyone is an adult the choice is real, and specific to this
  // ministry: an adult signing for themselves, or an adult signing for other
  // ADULTS in their legal guardianship, which is an ordinary situation here.
  //
  // Measured at the START OF CAMP, not today: a seventeen-year-old who turns
  // eighteen in June is an adult at camp in July, and the release covers the
  // week, not the day the form was filled in.
  const minorsOnForm = members.filter((m) => {
    const a = ageOn(m.dob, week?.startsOn);
    return a !== null && a < 18;
  });
  const hasMinor = minorsOnForm.length > 0;
  // Derived, never stored: storing it would need an effect to keep it honest
  // as dates of birth are typed, and an effect that rewrites the user's answer
  // is how a form starts arguing with the person filling it in.
  // One value now, because there is one claim: this signature covers everyone
  // on this registration. Whether that includes children is a fact of the
  // list, not a separate question.
  const effectiveSignerRole = 'all_registered';

  // Already registered for the week on screen, and this is not that
  // registration being edited? Say so, with the way in. Silence here is how a
  // family ends up with two half-built registrations for the same week.
  const alreadyRegisteredHere =
    !isUpdate && week?.eventId
      ? existingEvents.find((e) => e.eventId === week.eventId) ?? null
      : null;

  // A signature belongs to the registration it was given for, and therefore
  // to that EVENT. Reported 25 Aug: switching the event selection left the
  // "already signed" panel in place, so a signature given for Camp Celebrate
  // could roll onto the Adult Adventure Retreat without the words ever being
  // shown again.
  const signedEventId = signedAlready?.eventId ?? existing?.eventId ?? null;
  const alreadySigned =
    Boolean(signedAlready?.signedAt) && signedEventId != null && week?.eventId === signedEventId;
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
  // "I'm coming too": one tick adds the primary contact as an attendee.
  // Matching is by name against the contact fields, so the box reads as
  // checked when they are already listed (however that happened), and
  // unticking removes their row only while it is still otherwise empty --
  // once a t-shirt size or role has been chosen, removing quietly would
  // throw away real answers, so the row stays and the Remove button governs.
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const selfIncluded = members.some(
    (m) =>
      norm(m.firstName) === norm(family.contactFirst) &&
      norm(m.lastName) === norm(family.contactLast) &&
      norm(m.firstName) !== ''
  );

  function toggleSelf(e) {
    if (e.target.checked) {
      // Carry EVERYTHING the household already knows, not just the name.
      //
      // This used to copy firstName and lastName and nothing else, so ticking
      // "I'm coming too" left the person retyping their own date of birth and
      // sex -- facts already sitting in `people` and already handed to this
      // component as householdPeople. Reported 31 August, and it had been
      // noticed more than once before that, which is what a form asking for
      // something it already knows earns.
      //
      // Matched by name against the contact fields, the same way selfIncluded
      // matches. Spreading the household record is exactly what the
      // "Already in your household" buttons below do -- same shape, same
      // fields -- so the two ways of adding yourself now behave identically.
      // It also carries personId, which is what removes your own chip from
      // that list instead of offering to add you twice.
      const known = householdPeople.find(
        (h) =>
          norm(h.firstName) === norm(family.contactFirst) &&
          norm(h.lastName) === norm(family.contactLast) &&
          norm(h.firstName) !== ''
      );
      const self = known
        ? { ...emptyMember, ...known }
        : {
            ...emptyMember,
            firstName: family.contactFirst.trim(),
            lastName: family.contactLast.trim(),
          };
      // Fill the first still-blank row rather than stacking a new card under
      // an untouched "Person 1".
      const blankIdx = members.findIndex((m) => !m.firstName.trim() && !m.lastName.trim());
      if (blankIdx >= 0) {
        setMembers(members.map((m, j) => (j === blankIdx ? { ...m, ...self } : m)));
      } else {
        setMembers([self, ...members]);
      }
    } else {
      const idx = members.findIndex(
        (m) =>
          norm(m.firstName) === norm(family.contactFirst) &&
          norm(m.lastName) === norm(family.contactLast)
      );
      if (idx === -1) return;
      const m = members[idx];
      const untouched = !m.role && !m.tshirt && !m.firstTime && !m.dob && !m.sex;
      // A row with real answers used to be kept SILENTLY -- the tick sprang
      // back and nothing said why, which reads as a broken checkbox (reported
      // 25 Aug). Refusing to throw away answers is still right; doing it
      // without a word was not. Ask, then honour the answer either way.
      if (!untouched) {
        const ok = window.confirm(
          `${m.firstName || 'This person'} already has answers filled in on this registration.\n\nRemove them from it anyway? Their answers on this form will be discarded.`
        );
        if (!ok) return;
      }
      const next = members.filter((_, j) => j !== idx);
      setMembers(next.length ? next : [{ ...emptyMember }]);
    }
  }

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
    // A malformed email is worth catching here rather than after a
    // confirmation silently fails to arrive (asked for 25 Aug). Loose on
    // purpose -- see emailLooksValid.
    if (family.email && !emailLooksValid(family.email)) {
      setError(
        `That email address doesn't look right — "${family.email}". Please check it in "Your family or group" above; it is where your confirmation goes.`
      );
      return;
    }

    // HARD requirement: the agreements. These are conditions of attending, not
    // preferences -- so unlike the two permissions below, an unanswered one
    // stops the submit rather than saving as null.
    if (!alreadySigned && agreements.length > 0) {
      const unchecked = agreements.filter((a) => !agreed.has(a.key));
      if (unchecked.length > 0) {
        setError(
          `Please read and agree to: ${unchecked.map((a) => a.title).join(', ')} — in the “Agreements” card below.`
        );
        return;
      }
      if (!signerName.trim()) {
        setError('Please type your full name as your signature at the bottom of the “Agreements” card.');
        return;
      }
      if (!coversAll) {
        setError(
          'Please tick the box confirming you are able to sign for everyone listed on this registration — in the “Agreements” card below.'
        );
        return;
      }
      // The signature must name the accountable adult filling in this form --
      // the primary contact from "Your family or group" above. Testing proved the need:
      // "Alberto Gonzales" signed for a family containing no such person. A
      // guardian with a different name corrects the contact fields, which sit
      // one card up and are theirs to edit.
      const norm2 = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const contactFull = norm2(`${family.contactFirst} ${family.contactLast}`);
      if (norm2(signerName) !== contactFull) {
        setError(
          `The signature must match the primary contact's name — "${family.contactFirst} ${family.contactLast}". If someone else is completing this form, update the primary contact in "Your family" first, so the signature names the person actually responsible.`
        );
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
        volunteerOptionId: week.volunteerOptionId ?? null,
        notes,
        isUpdate,
        agreements: alreadySigned
          ? null
          : {
              signerName: signerName.trim(),
              signerRole: effectiveSignerRole,
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
        {/* The required deposit (Larry, 24 Aug), asked for at the moment the
            family is most ready to hear it -- right after "you're in". Not a
            gate: the registration above is already saved either way. */}
        {/* Gated on whether anything has actually been PAID, not on whether
            this was an update (reported 25 Aug: editing an unpaid registration
            hid the deposit panel). "Update" and "already paid" are different
            facts, and only the second means the ask is finished. The server
            returns depositDue with the save; undefined errs toward asking. */}
        {result.depositDue !== false && (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-left text-amber-900">
            <p className="font-semibold">
              {isUpdate
                ? 'Still outstanding: the deposit holds your spots.'
                : 'Next step: the deposit holds your spots.'}
            </p>
            {/* Careful with the second sentence: the site does NOT know the
                ministry's balance-due date, and "any time before the event"
                was a promise nobody had authorised (flagged 24 Aug). Until
                staff set a due date -- Staff Questions §3 (Events & pricing)
                -- this says only what is certainly true. */}
            <p className="mt-1 text-sm">
              The deposit is your family&rsquo;s (or group&rsquo;s) commitment to come — and it lets the
              ministry book vendors and reserve locations with real numbers. You can pay
              it from your dashboard in about a minute, and the rest of the balance can
              be paid in one go or in parts. Camp staff will be in touch about the
              balance due date.
            </p>
          </div>
        )}
        {/* "Whenever suits" was too generous (flagged 24 Aug): camp staff
            need these to plan, and a form that arrives the week of camp is
            most of the way to useless. Whether they should GATE confirmation
            is a staff decision (Staff Questions §1); this wording is honest
            either way. */}
        <p className="mt-3 text-neutral-700">
          <strong>Also before camp:</strong> each person attending has a short
          details form — allergies, medications, support needs and an emergency
          contact. You&rsquo;ll find a link for each of them on your dashboard.{' '}
          <strong>Please fill them in soon</strong> — camp staff use them to plan
          support, meals and medical cover, and a registration isn&rsquo;t complete
          without them.
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
        {/* A plain anchor, deliberately, NOT a <Link>. The action above
            revalidates the dashboard so a client navigation would now be
            correct -- but this is the one click in the whole site where a
            stale page is guaranteed to look like lost data ("you haven't
            registered anyone yet", seconds after registering). A full page
            load cannot be stale. One extra fetch is a fair price. */}
        <a href="/account/dashboard/" className="btn-primary mt-6 inline-block">
          Go to My Dashboard
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* The escape hatch lives here, inside the wizard, so it vanishes with
          the form when the success card (which has its own dashboard button)
          takes over. */}
      <p className="text-center text-sm">
        <Link href="/account/dashboard/" className="text-brand underline font-semibold">
          &larr; Back to my dashboard
        </Link>
      </p>

      {/* 1 — what they're registering for. First, because it sets the price. */}
      <Card
        n={1}
        title="What you're registering for"
        subtitle={
          weeks.length === 1
            ? 'One session is open for registration right now.'
            : 'Choose the session your family or group is attending.'
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

        {/* Starting a new registration no longer inherits another week's
            people (25 Aug), which is right — but it means a family who is
            already on this week would otherwise see an empty form and build a
            second, half-finished registration beside the real one. */}
        {alreadyRegisteredHere && (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            <span className="font-semibold">
              You already have a registration for this session
            </span>{' '}
            ({alreadyRegisteredHere.people}{' '}
            {alreadyRegisteredHere.people === 1 ? 'person' : 'people'}). This form is blank
            because it starts something new.{' '}
            <a
              href={`/register/family/?event=${alreadyRegisteredHere.eventId}`}
              className="font-semibold text-brand underline"
            >
              Open the one you already have
            </a>{' '}
            to add or change people on it.
          </p>
        )}
      </Card>

      {/* 2 — the family's own details. */}
      <Card
        n={2}
        title="Your family or group"
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
        {/* Said out loud because it is now true: naming a contact adds them to
            the household (0037). Before, the name went into the household's
            own name field and no such person existed anywhere -- which is how
            a household ended up called "Victoria" with only Lawrence in it. */}
        <p className="mt-1.5 text-sm text-neutral-500">
          This is who camp staff will call or email. They&rsquo;re added to your household
          as the contact — whether or not they&rsquo;re attending — and you can change who
          it is later from Manage Household.
        </p>
        <label className={label}>Email</label>
        <input type="email" className={input} value={family.email} onChange={setF('email')} />
        <label className={label}>Phone</label>
        <input
          type="tel"
          className={input}
          value={family.phone}
          onChange={setF('phone')}
          onBlur={() => setFamily((f) => ({ ...f, phone: formatPhone(f.phone) }))}
        />
        {/* Street / city / state / ZIP as four fields. The checks are all
            free and local: a state DROPDOWN (the commonest bad value becomes
            impossible), a ZIP tidied to 5 or ZIP+4 with a gentle hint if it
            is neither, and city case repaired only when it is all-caps or
            all-lower (so "McMinnville" is never "corrected"). No address
            lookup service is called -- see the Staff Questions log for why
            that is a deliberate choice and what it would take to add one. */}
        <label className={label}>Street address</label>
        <input
          className={input}
          value={family.address}
          onChange={setF('address')}
          placeholder="123 Main St, Apt 4"
        />
        <div className="grid sm:grid-cols-[2fr_1fr_1fr] gap-4">
          <div>
            <label className={label}>City</label>
            <input
              className={input}
              value={family.city}
              onChange={setF('city')}
              onBlur={() => setFamily((f) => ({ ...f, city: tidyCity(f.city) }))}
            />
          </div>
          <div>
            <label className={label}>State</label>
            <select className={input} value={family.state} onChange={setF('state')}>
              <option value="">—</option>
              {US_STATES.map(([code, name]) => (
                <option key={code} value={code} title={name}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>ZIP</label>
            <input
              className={input}
              value={family.postalCode}
              onChange={setF('postalCode')}
              onBlur={() => setFamily((f) => ({ ...f, postalCode: formatZip(f.postalCode) }))}
              inputMode="numeric"
              placeholder="37814"
            />
            {!zipLooksValid(family.postalCode) && (
              <p className="mt-1 text-xs text-amber-700">
                A ZIP is five digits (or nine, as 37814-1234).
              </p>
            )}
          </div>
        </div>
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
          {/* Said ONCE, at the top, rather than in small grey type under every
              person (reported 25 Aug). It is the most important thing on this
              card that is not a field: what this form does NOT ask for, and
              where the rest gets asked. */}
          <div className="rounded border border-brand/30 bg-brand-light/60 px-4 py-3 text-sm">
            <p className="font-semibold text-brand-dark">
              This form asks no medical questions.
            </p>
            <p className="mt-1 text-neutral-700">
              Each person attending gets a short details form afterwards — medications,
              allergy detail, what helps on a hard day, and an emergency contact. You&rsquo;ll
              find a link for each of them on your dashboard as soon as you{' '}
              {isUpdate ? 'update' : 'submit'}.
            </p>
          </div>

          {/* One tick instead of retyping the name from the card above.
              Requested in testing (24 Aug): the primary contact is usually
              attending, and typing your own name twice on one form is the
              kind of small silliness people notice. */}
          <label className="flex items-center gap-3 rounded border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={selfIncluded}
              onChange={toggleSelf}
            />
            <span className="text-sm">
              <span className="font-semibold">I&rsquo;m coming too</span> — add{' '}
              {family.contactFirst.trim() || 'the primary contact'} as one of the people
              attending.
            </span>
          </label>
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
                  <label className={label}>
                    Preferred name (for nametags), if different
                  </label>
                  {/* E45, second half. It was asked only on Manage household,
                      which a family registering a NEW person has no reason to
                      visit — so the nametag list stayed empty for exactly the
                      people most likely to need one. Registration is where the
                      names actually arrive, so it is asked here too. Same
                      column either way, so setting it in one place shows in
                      the other. */}
                  <input
                    className={input}
                    value={m.preferredName}
                    onChange={setM(i, 'preferredName')}
                    placeholder={m.firstName || 'Leave blank to use their first name'}
                  />
                </div>
                <div>
                  <label className={label}>Role</label>
                  <select className={input} value={m.role} onChange={setM(i, 'role')}>
                    <option value="" disabled>
                      Choose a role…
                    </option>
                    <option value="Camper with disability">Camper with disability</option>
                    <option value="Parent/Guardian">Parent/Guardian</option>
                    {/* Label widened 25 Aug: a parent or volunteer may bring a
                        child who is nobody's sibling. The VALUE stays "Sibling"
                        because the server maps it to the camp_role enum -- the
                        option carried no value attribute, so relabelling alone
                        would have written every sibling as a camper. */}
                    <option value="Sibling">Sibling / Child</option>
                    <option value="Caregiver">Caregiver</option>
                    <option value="Volunteer">Volunteer</option>
                  </select>

                  {/* One person, two roles at the same camp (0069). A parent
                      who is also volunteering is rare and real, and the
                      ministry charges them ONCE — the second role is written
                      with no fee at all rather than a fee cancelled by a
                      discount, so nothing downstream has two numbers to
                      reconcile.

                      Hidden when the role IS Volunteer, because "also
                      volunteering" is then a question about itself. */}
                  {m.role && m.role !== 'Volunteer' && week?.volunteerOptionId && (
                    <label className="mt-2 flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={Boolean(m.alsoVolunteering)}
                        onChange={(e) =>
                          setMembers(
                            members.map((mm, j) =>
                              j === i ? { ...mm, alsoVolunteering: e.target.checked } : mm
                            )
                          )
                        }
                      />
                      <span>
                        <span className="font-semibold">
                          {m.firstName || 'This person'} is also volunteering
                        </span>{' '}
                        <span className="text-neutral-600">
                          &mdash; no extra fee. The volunteer team will be in touch about the
                          separate volunteer application.
                        </span>
                      </span>
                    </label>
                  )}
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
              {/* NO medical questions here -- removed 24 Aug, by decision.
                  The two "short version" free-text boxes that used to sit here
                  collected unstructured text that duplicated the details form
                  and broke its completion status. Registration secures the
                  place; the details form (linked from the dashboard, and
                  named in the note below) is the one collector of support,
                  medical and dietary information. */}

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
                      It&rsquo;s how families connect before and after. Your household
                      appears as one combined entry with the adults&rsquo; contact details
                      — children are never listed individually. Uncheck to be left out;
                      nothing else about your registration changes.
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
            </div>
          ))}
          {/* Saved household members who are not on this registration yet.
              One click each. The role is deliberately left blank -- it can
              differ per event (a sibling one year, a volunteer the next), so
              it is the one thing we never carry over. */}
          {(() => {
            const onForm = new Set(
              members.map((m) => m.personId).filter(Boolean)
            );
            const available = householdPeople.filter((p) => !onForm.has(p.personId));
            if (available.length === 0) return null;
            return (
              <div className="rounded border border-neutral-200 bg-neutral-50 p-4">
                                <p className="text-sm font-semibold">Already in your household</p>
                <p className="mt-0.5 text-xs text-neutral-600">
                  Tap to add them to this registration — no need to type them in again.
                  &ldquo;Household&rdquo; here means everyone on your account, related or not
                  — a group home or church group works the same way.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {available.map((p) => (
                    <button
                      key={p.personId}
                      type="button"
                      onClick={() =>
                        setMembers([
                          ...members.filter(
                            // Drop a still-blank row so adding someone doesn't
                            // leave an empty card stranded above them.
                            (m) => m.firstName.trim() || m.lastName.trim() || m.personId
                          ),
                          { ...emptyMember, ...p },
                        ])
                      }
                      className="rounded-full border border-brand bg-white px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand-light"
                    >
                      + {p.firstName} {p.lastName}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-outline !py-2"
              onClick={() => setMembers([...members, { ...emptyMember }])}
            >
              + Add someone new
            </button>
            <span className="text-sm text-neutral-500">
              Anyone you add here is saved to your household for next time.
            </span>
          </div>
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
                    {/* Not a menu of legal categories. The release covers the
                        people on this registration — that list is a few inches
                        up the page — and what it needs from the signer is the
                        claim that they can give it for those people.

                        Two earlier attempts asked this as a choice ("myself and
                        my household" / "people I am parent or guardian for")
                        and both were reported as unclear, the second one after
                        a release covering a seven-year-old recorded itself as
                        signed "for themselves". A question nobody can answer
                        confidently is the wrong question. */}
                    <span className={label}>This signature covers</span>
                    <div className="rounded border border-brand bg-brand-light px-3 py-2 text-sm">
                      <p className="font-semibold">
                        Everyone listed in &ldquo;Who is coming&rdquo; above
                        {named.length > 0 && ` — ${named.length} ${
                          named.length === 1 ? 'person' : 'people'
                        }`}
                      </p>
                      {named.length > 0 && (
                        <p className="mt-1 text-neutral-700">
                          {named
                            .map((m) => `${m.firstName} ${m.lastName}`.trim())
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}
                      <label className="mt-2 flex items-start gap-2 font-medium">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={coversAll}
                          onChange={(e) => setCoversAll(e.target.checked)}
                        />
                        <span>
                          I am legally able to sign these agreements on behalf of everyone
                          listed above.
                        </span>
                      </label>
                      {hasMinor && (
                        <p className="mt-2 text-xs text-neutral-600">
                          {minorsOnForm.length === 1
                            ? `${minorsOnForm[0].firstName || 'One person'} is under 18 at camp, so this includes signing as their parent or legal guardian.`
                            : `${minorsOnForm.length} of them are under 18 at camp, so this includes signing as their parent or legal guardian.`}
                        </p>
                      )}
                    </div>
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

      {/* The standalone copy of this message used to live here. It was removed
          on 25 Aug: the sticky bar below shows the same sentence, so scrolling
          to the bottom showed it twice. One message, in the place you are
          looking when you press the button. */}

      {/* The running total and the way out, pinned to the bottom of the
          viewport so a long scroll never hides either. */}
      <div className="sticky bottom-0 z-20 -mx-4 sm:mx-0 border-t border-neutral-200 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] sm:rounded-lg sm:border">
        {/* The ONLY copy of this message (25 Aug). It lives here because this
            is where the person is looking when they press the button; the
            standalone copy that used to sit above showed the same sentence
            twice once you scrolled to the bottom. */}
        {error && (
          <p
            role="alert"
            className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
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

      {/* This used to say "ask at camp@luke14ministries.net" -- written before
          the scholarship request existed in the site. It sent a family off to
          compose an email for something the platform now handles, and put the
          burden of asking on the person least likely to want to (26 Aug).

          The reassurance stays where it is, because THIS is the moment it is
          needed: someone looking at $495 and wondering whether to carry on.
          Only the instruction changes -- and it now says the asking happens
          after submitting, so nobody stops here believing they must sort the
          money out first.

          ⚠ REVISIT AFTER THE DEPOSIT DECISION (Decisions doc, question 9).
          This assumes today's behaviour: a registration reaches staff whether
          or not the deposit is paid. If the deposit becomes required to
          submit, this line is the FIRST place that has to say so -- a family
          reading "submit your registration, then..." and being refused at the
          button has been misled by us. The deposit paragraph in the
          confirmation email changes with it. */}
      <p className="text-center text-sm text-neutral-500 pb-2">
        Cost shouldn&rsquo;t decide this. Submit your registration, then use
        &ldquo;Request help with the fee&rdquo; on your dashboard &mdash; asking
        does not affect anyone&rsquo;s place.
        {isUpdate
          ? ' Updating replaces your saved answers for this session; people are matched by name and date of birth, so nobody is duplicated.'
          : ''}
      </p>
    </div>
  );
}
