import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStaff } from '@/lib/staff';
import { getProgramLeadership, getProgramRoster, getProgramLeaders, ageAt } from '@/lib/programs';

export const metadata = { title: 'My Program — Luke 14 Ministries' };

// The program leader's whole view of the system: who is in their program.
//
// It is mostly a list, and that is the design rather than a first draft. A
// leader is here to know who they have got, who is buddied with whom, and who
// they need to ask the coordinator about before Monday morning. Everything
// else -- the medical detail, the payments, the other programs -- belongs to
// people whose job it is.
//
// WHAT IS NOT ON THIS PAGE, and why (see migration 0061):
//   * No allergy detail, no medications, no behaviour notes. A flag says
//     "ask"; the coordinator holds the answer. A leader who needs the detail
//     -- a nurse, a one-to-one carer -- is granted it separately and it
//     expires by itself.
//   * No room or cabin. A program leader does not need to know where a family
//     sleeps.
//   * No edit controls at all. Moving a person between programs is a
//     coordinator's decision, so that the roster is always the single answer
//     to "where is this child meant to be?"
export default async function MyProgramPage({ searchParams }) {
  const params = await searchParams;
  const [staff, leaderships] = await Promise.all([getStaff(), getProgramLeadership()]);

  // Staff who lead nothing land here from a stray link; send them to the
  // portal that is actually theirs.
  if (!leaderships.length) {
    if (staff) redirect('/admin/programs');
    redirect('/admin');
  }

  const selectedKey = params?.grant || `${leaderships[0].programId}:${leaderships[0].eventId}`;
  const current =
    leaderships.find((l) => `${l.programId}:${l.eventId}` === selectedKey) ?? leaderships[0];

    const [roster, leaders] = await Promise.all([
    getProgramRoster({ programId: current.programId, eventId: current.eventId }),
    getProgramLeaders({ programId: current.programId, eventId: current.eventId }),
  ]);
  const lead = leaders.find((l) => l.isLead) ?? null;
  const assistants = leaders.filter((l) => !l.isLead);

  const rows = roster
    .map((r) => ({
      id: r.participant_id,
      name: [r.display_name, r.last_name].filter(Boolean).join(' '),
      formalName:
        r.first_name && r.display_name && r.first_name !== r.display_name
          ? `${r.first_name} ${r.last_name}`
          : null,
      age: ageAt(r.date_of_birth, current.startsOn),
      role: r.camp_role,
      buddy: r.buddy_name,
      buddyRequired: r.buddy_required,
      allergies: r.has_allergies,
      support: r.has_support_needs,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const needAsking = rows.filter((r) => r.allergies || r.support).length;

  const ROLE_LABEL = {
    camper: 'Camper',
    sibling: 'Sibling',
    parent_guardian: 'Parent / guardian',
    caregiver: 'Caregiver',
    volunteer: 'Volunteer',
    childcare: 'Childcare',
    support_team: 'Support team',
  };

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">{current.programName}</h2>
      <p className="text-sm text-neutral-500 mb-4">
        {current.eventName}
        {current.startsOn ? ` · from ${current.startsOn}` : ''} — {rows.length}{' '}
                {rows.length === 1 ? 'person' : 'people'} in your program.
      </p>

      {/* Who else leads this program, lead first. Two leaders on one program
          is normal (a lead and an assistant); this line is so each knows the
          other, and so "who is the lead?" has one answer. */}
      {leaders.length > 0 && (
        <p className="-mt-3 mb-4 text-sm text-neutral-600">
          {lead ? (
            <>
              Lead: <strong>{lead.name}</strong>
            </>
          ) : (
            'No lead named yet'
          )}
          {assistants.length > 0 && <> · with {assistants.map((a) => a.name).join(', ')}</>}
        </p>
      )}

      {leaderships.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {leaderships.map((l) => {
            const key = `${l.programId}:${l.eventId}`;
            const active = key === `${current.programId}:${current.eventId}`;
            return (
              <Link
                key={l.id}
                href={`/admin/my-program?grant=${encodeURIComponent(key)}`}
                className={`rounded-full border px-3 py-1 text-sm ${
                  active
                    ? 'border-brand bg-brand-light font-semibold text-brand-dark'
                    : 'border-neutral-300 hover:bg-neutral-50'
                }`}
              >
                {l.programName} · {l.eventName}
              </Link>
            );
          })}
        </div>
      )}

      {/* Said once, plainly, at the top -- so that a leader who wonders where
          the allergy details are does not go hunting, or worse, ask a family
          directly. */}
      <div className="mb-5 rounded border border-brand/30 bg-brand-light/50 px-4 py-3 text-sm">
        <strong>What the flags mean.</strong> A marker here tells you there is
        something to ask about — it does not tell you what. Allergy details,
        medications and support plans stay with the camp coordinator, who will
        go through them with you before the week starts.{' '}
        {needAsking > 0 ? (
          <>
            <strong>
              {needAsking} {needAsking === 1 ? 'person' : 'people'}
            </strong>{' '}
            in this list {needAsking === 1 ? 'has' : 'have'} a flag.
          </>
        ) : (
          'Nobody in this list has a flag yet.'
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-neutral-200 bg-white p-6 text-neutral-500">
          Nobody has been placed in {current.programName} for {current.eventName} yet. This page
          fills up as the coordinator assigns people — there is nothing for you to do here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Age</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Buddy</th>
                <th className="px-3 py-2 font-semibold">Ask about</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 align-top">
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.name}</span>
                    {r.formalName && (
                      <span className="block text-xs text-neutral-500">
                        on paperwork: {r.formalName}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.age ?? '—'}</td>
                  <td className="px-3 py-2">{ROLE_LABEL[r.role] ?? r.role}</td>
                  <td className="px-3 py-2">
                    {r.buddy ? (
                      r.buddy
                    ) : r.buddyRequired ? (
                      <span className="text-amber-800">buddy needed — not paired yet</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.allergies && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          Allergies
                        </span>
                      )}
                      {r.support && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          Support needs
                        </span>
                      )}
                      {!r.allergies && !r.support && (
                        <span className="text-neutral-400">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-neutral-500">
        Something wrong on this list — somebody missing, somebody who should not be here, a name
        spelled wrong? Tell the camp coordinator rather than the family. Changes are made in one
        place so that the roster and this page never disagree.
      </p>
    </div>
  );
}
