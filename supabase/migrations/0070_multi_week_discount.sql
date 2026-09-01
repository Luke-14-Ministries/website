-- 0070_multi_week_discount.sql
--
-- The both-weeks discount (E11), built as a RULE EVALUATED FROM STORED FACTS
-- rather than something the registration form works out.
--
-- WHY NOT IN THE WIZARD. The obvious design is a "register for both weeks"
-- multi-select. It fails the common case: most families do not decide both
-- weeks in one sitting -- week 2 gets added later, after a conversation or when
-- a place frees up. A discount computed in the form would then depend on WHEN
-- somebody decided rather than WHAT they decided, and the family who registers
-- twice, months apart, silently pays more than the family who registered once
-- in October. Recomputing from the database catches both, in either order.
--
-- WHAT "BOTH WEEKS" MEANS, precisely: two live registrations for two different
-- events in the same PROGRAM, where the program is the part of an event name
-- before the em dash. "Camp Celebrate 2027 — Week 1" and "Camp Celebrate 2027 —
-- Week 2" share the program "Camp Celebrate 2027"; the Adult Adventure Retreat
-- shares it with nothing. This mirrors programOf() in lib/events.js, which is
-- already how the rest of the site groups weeks.
--
-- THE RULE, as confirmed by staff on 31 August 2026:
--   * 50% off, applied to the LATER-STARTING event's participant row.
--     Deterministic on purpose -- families register the two weeks in either
--     order, so "the second one you happened to submit" would give two families
--     with identical registrations different bills.
--   * The person must be volunteering. WHETHER THAT MEANS BOTH WEEKS OR JUST
--     ONE IS STILL OPEN -- see the constant below.
--
-- THE ONE THING IT WILL NEVER TOUCH: a discount somebody entered by hand.
-- Every discount this function writes is stamped with its own reason, and it
-- only ever clears rows carrying THAT reason. A staff member's manual discount,
-- or a scholarship, is invisible to it. Without that rule a recompute would
-- quietly erase a decision a person made about a family's money.

alter table public.registration_participants
  add column if not exists discount_reason text;

comment on column public.registration_participants.discount_reason is
  'Why discount_cents is what it is. NULL means somebody set it by hand and it is nobody else''s business. A non-null value marks a discount applied by a rule -- recalc_multi_week_discount() writes and clears only its own reason, never a manual one.';

create or replace function public.recalc_multi_week_discount(p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  -- ---------------------------------------------------------------------
  -- THE RULE. Change these three lines and nothing else.
  --
  -- v_require_volunteer_both is the OPEN question (Q7 on the reviewer
  -- ledger): does the family have to be volunteering BOTH weeks, or is
  -- volunteering ONE enough? Staff are being asked on 1 September 2026.
  --
  -- It defaults to the STRICTER reading deliberately. Granting a discount
  -- nobody was entitled to means asking a family for money back; withholding
  -- one they were owed means a family asks and staff fix it in a click. The
  -- second mistake is the recoverable one, so it is the one to default to.
  -- ---------------------------------------------------------------------
  c_percent            constant int  := 50;
  c_require_vol_both   constant bool := true;
  c_reason             constant text := 'Both weeks';

  r record;
begin
  if p_person_id is null then return; end if;

  -- Clear anything this rule previously wrote for this person. Everything
  -- below then re-earns its place, so a cancelled week removes its own
  -- discount without needing to know it ever existed.
  update public.registration_participants rp
     set discount_cents = 0,
         discount_reason = null
   where rp.person_id = p_person_id
     and rp.discount_reason like c_reason || '%';

  for r in
    with live as (
      select
        rp.id,
        rp.camp_role,
        rp.fee_cents,
        e.id                                       as event_id,
        e.starts_on,
        -- programOf(), in SQL. split_part on the em dash; an event with no
        -- dash is its own program and pairs with nothing.
        btrim(split_part(e.name, ' — ', 1))        as program
      from public.registration_participants rp
      join public.registrations r2 on r2.id = rp.registration_id
      join public.events e         on e.id  = r2.event_id
      where rp.person_id = p_person_id
        and rp.status <> 'cancelled'
    ),
    grouped as (
      select
        program,
        count(distinct event_id)                                  as weeks,
        count(*) filter (where camp_role = 'volunteer')           as volunteer_rows,
        count(distinct event_id) filter (where camp_role = 'volunteer') as volunteer_weeks
      from live
      group by program
    )
    select l.id, l.fee_cents
    from live l
    join grouped g on g.program = l.program
    where g.weeks >= 2
      and case
            when c_require_vol_both then g.volunteer_weeks >= g.weeks
            else g.volunteer_rows >= 1
          end
      -- EXACTLY ONE ROW carries the credit, chosen explicitly rather than by
      -- comparing tuples: max((starts_on, event_id)) looks natural and does not
      -- exist in Postgres, which is how this was caught before it shipped.
      --
      -- The later-starting event, and among rows at that event the FEE-BEARING
      -- one -- somebody holding both a parent row and the zero-fee volunteer
      -- second role (0069) at the same week must have the discount land on the
      -- row that actually costs something. Ties broken by id so the answer is
      -- stable rather than whichever row the planner happens to return.
      and l.fee_cents > 0
      and l.id = (
        select l2.id
        from live l2
        where l2.program = l.program
          and l2.fee_cents > 0
        order by l2.starts_on desc, l2.event_id desc, l2.id desc
        limit 1
      )
  loop
    update public.registration_participants
       set discount_cents  = round(r.fee_cents * c_percent / 100.0),
           discount_reason = c_reason || ' (' || c_percent || '% off the later week)'
     where id = r.id;
  end loop;
end;
$$;

comment on function public.recalc_multi_week_discount(uuid) is
  'Re-applies the both-weeks discount for one person from scratch: clears what it previously wrote, then re-earns it. Safe to call repeatedly, and safe to call after a cancellation -- that is how the discount goes away. Only ever touches discounts carrying its own reason, never one a staff member set by hand.';

grant execute on function public.recalc_multi_week_discount(uuid) to authenticated;
