-- 0066_buddy_required_tristate.sql
--
-- Every camper is treated as needing a buddy until somebody says otherwise
-- (decided 31 August 2026). That is a change of DEFAULT, not just of display,
-- and the column could not express it.
--
-- It was `boolean not null default false`, so "nobody has looked at this yet"
-- and "the coordinator has decided this camper does not need one" were the same
-- value. The board could therefore show one or the other, never both correctly.
--
-- Three states now:
--
--   NULL   nobody has decided. Shows on the Buddies board as needing one,
--          because the safe direction with support needs is to ask.
--   true   decided: needs a buddy.
--   false  decided: does NOT need one. Only staff can set this, and only
--          through a confirmation, because it removes somebody from the list
--          of children whose support is being arranged.
--
-- EXISTING `false` ROWS BECOME NULL. They have to: under the family form that
-- was removed yesterday, a family actively answering "no" and a family never
-- asked both stored false, so no existing false can be trusted to mean a
-- decision. Setting them to NULL puts every camper back in front of the
-- coordinator once, which is the error worth making -- the opposite mistake is
-- a child who needed one-to-one support quietly absent from the board.
--
-- Rows that say `true` are left exactly as they are: somebody did decide those.

alter table public.person_support
  alter column buddy_required drop not null,
  alter column buddy_required set default null;

update public.person_support
   set buddy_required = null
 where buddy_required = false;

comment on column public.person_support.buddy_required is
  'Does this person need a one-to-one buddy? NULL = nobody has decided, and the Buddies board treats that as "needs one" so nobody is quietly dropped. true = decided yes. false = decided no, set by staff only, behind a confirmation. Families are not asked this at registration (removed 31 Aug 2026) -- the family coordinator works it out by talking to them.';
