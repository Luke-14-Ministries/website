-- 0062_apostles_creed_affirmation.sql
--
-- The ministry requires volunteers to affirm the Apostles' Creed, and nothing
-- on the volunteer application asked. Raised by Lee Anne as item L2 in the
-- 29 August reviewer response; confirmed by Larry the same day that the faith
-- questions are for VOLUNTEERS ONLY -- never families, never campers.
--
-- WHY THIS IS AN AGREEMENT AND NOT A COLUMN
--
-- The obvious implementation is a boolean on volunteer_applications. It is the
-- wrong one. What has to be answerable in 2029 is not "did this person tick a
-- box" but "what words did this person affirm, on what date" -- and a boolean
-- cannot answer that once somebody edits the wording. public.agreements
-- already solves exactly this: text is versioned by (key, version), and
-- 0028 established the rule that once a version is published and signed its
-- text must never change under the people who signed it. A later rewording
-- becomes version 2, and version 1 still says what version 1 said.
--
-- So this migration inserts one row and no schema. The signature goes in
-- agreement_signatures like every other one, against person_id.
--
-- ⚠️ WHY THERE IS DELIBERATELY NO agreement_requirements ROW
--
-- Read this before "finishing the job" by adding one.
--
-- The family registration wizard loads its agreements from
-- agreement_requirements (app/register/family/page.jsx), and until today that
-- query took every required agreement for the open events WITHOUT filtering on
-- applies_to. A requirement row for this agreement -- even one scoped to
-- volunteers -- would therefore have put the Apostles' Creed in front of every
-- registering family, which is the precise thing Larry ruled out.
--
-- Two defences, deliberately both:
--   1. No requirement row exists, so the wizard's query cannot return it. The
--      volunteer application looks the agreement up by key instead.
--   2. That query has been hardened in the same commit to filter applies_to to
--      ('household', 'participant'), so the trap is closed for whoever comes
--      next with a genuinely volunteer-scoped agreement.
--
-- If you ever do add a requirement row here, 'volunteer' is not yet a legal
-- value for applies_to (0001 allows 'household' and 'participant' only).
-- Widening that constraint is the moment to re-read defence 2.
--
-- ON THE WORDING. The text is the ministry's, unchanged, and "catholic" is
-- deliberately lower-case: it carries its original meaning of *universal* --
-- the whole Christian Church -- rather than naming a denomination. This is the
-- language the board affirmed and requires, confirmed 30 August 2026. It is
-- recorded here because it is exactly the kind of detail a well-meaning later
-- reader "corrects" into something the board never approved.

insert into public.agreements (id, key, version, title, body, delivery, active) values
(
  'a9ee0000-0000-4000-8000-000000000007',
  'apostles_creed', 1,
  'Affirmation of the Apostles'' Creed',
  'Luke 14 Ministries is a Christian organization and Camp Celebrate is a Christian camp. As such, all camp staff and volunteers are required to affirm the Apostles'' Creed as a condition of participating at Camp Celebrate as a support member.

I believe in God,
the Father almighty,
Creator of heaven and earth,
and in Jesus Christ, his only Son, our Lord,
who was conceived by the Holy Spirit,
born of the Virgin Mary,
suffered under Pontius Pilate,
was crucified, died and was buried;
he descended into hell;
on the third day he rose again from the dead;
he ascended into heaven,
and is seated at the right hand of God the Father almighty;
from there he will come to judge the living and the dead.

I believe in the Holy Spirit,
the holy catholic Church,
the communion of saints,
the forgiveness of sins,
the resurrection of the body,
and life everlasting.

Amen.',
  'internal_document', true
)
on conflict (key, version) do nothing;


comment on table public.agreements is
  'Versioned agreement text. Once a (key, version) is published and signed, its text must never change -- reword by inserting the next version. Not every agreement has an agreement_requirements row: apostles_creed (0062) deliberately has none, so that the family registration wizard cannot surface a volunteers-only affirmation to families.';
