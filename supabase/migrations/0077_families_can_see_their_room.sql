-- 0077_families_can_see_their_room.sql
--
-- A family can see where they are sleeping, once it is published. They never
-- could.
--
-- Found 29 September 2026 by the bot round on Testing Script 4 §11.10, and
-- older than everything else found that day: it has been true since 0042.
-- Two faults, either one enough:
--
--   1. lodging_assignments_select decided "is this event published?" with a
--      subquery on public.lodgings. A policy's subquery runs under the OTHER
--      table's policies for the same person, and lodgings_select is
--      is_staff() -- so for a family the subquery found no row, and their own
--      assignment was invisible whether or not staff had pressed Publish.
--   2. Even with the row visible, the dashboard embeds the room's name and
--      its building's name FROM lodgings, which the same policy refused.
--
-- The fix keeps the shape the schema uses everywhere else: SECURITY DEFINER
-- helpers answer the questions the policies need to ask without the asker
-- needing to read the tables underneath.
--
--   lodging_published_for(lodging_id)  -- is this bed's event published?
--   my_visible_lodging_ids()           -- the beds my household is assigned
--                                         to on published events, plus the
--                                         building each one sits in
--
-- Staff policies are untouched. Nothing here lets a family see anybody
-- else's bed, any unpublished draft, or any room they are not in.

create or replace function public.lodging_published_for(p_lodging_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.lodging_assignments_published_at is not null
     from public.lodgings l
     join public.events e on e.id = l.event_id
     where l.id = p_lodging_id),
    false);
$$;

grant execute on function public.lodging_published_for(uuid) to authenticated;

create or replace function public.my_visible_lodging_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select l.id, l.parent_id
    from public.lodging_assignments a
    join public.lodgings l on l.id = a.lodging_id
    join public.events e on e.id = l.event_id
    where a.registration_participant_id in (select public.my_participant_ids())
      and e.lodging_assignments_published_at is not null
  )
  select id from mine
  union
  select parent_id from mine where parent_id is not null;
$$;

grant execute on function public.my_visible_lodging_ids() to authenticated;

-- The assignment: mine, and published -- decided by the helper, not by a
-- subquery the asker cannot run.
drop policy if exists lodging_assignments_select on public.lodging_assignments;
create policy lodging_assignments_select on public.lodging_assignments
  for select using (
    public.is_staff()
    or (
      public.lodging_published_for(lodging_id)
      and registration_participant_id in (select public.my_participant_ids())
    )
  );

-- The room (and its building): only the ones the family is actually in.
drop policy if exists lodgings_select on public.lodgings;
create policy lodgings_select on public.lodgings
  for select using (
    public.is_staff()
    or id in (select public.my_visible_lodging_ids())
  );

comment on function public.my_visible_lodging_ids() is
  'The lodgings a family may read: the beds their own participants are assigned to on events whose room assignments are published, plus each bed''s parent building (0077). Used by lodgings_select.';
