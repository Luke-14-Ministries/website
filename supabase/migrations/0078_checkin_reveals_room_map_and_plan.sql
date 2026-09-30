-- 0078_checkin_reveals_room_map_and_plan.sql
--
-- Checking in reveals where you are staying, the campus map, and the plan of
-- your building.
--
-- Asked for 29 September 2026. The venue (Tennessee Baptist Mission Board's
-- Carson Springs page) publishes a campus map and a floor plan for each lodge.
-- A family arriving at camp needs exactly three things from their phone: the
-- room, the map, and the plan of the building the room is in. Lawrence's
-- rule: CHECK-IN is the trigger. Staff may still publish room assignments
-- ahead of time (the 0042 gate is unchanged), but a person who has been
-- checked in sees their room whether or not the event was published, and
-- only a checked-in person sees the map and plan links.
--
--   events.campus_map_url        -- one per event (the venue's map)
--   lodgings.schematic_url       -- on the BUILDING; rooms inherit it
--
-- The Lodge (rooms 101-312) has no plan on the venue's page -- a question for
-- Larry -- so it shows the campus map only. Carson Hall, RV sites and Off
-- Campus likewise.

alter table public.events add column if not exists campus_map_url text;
alter table public.lodgings add column if not exists schematic_url text;

comment on column public.events.campus_map_url is
  'Link to the venue''s campus map (a PDF the venue publishes). Shown to a family once a person is checked in (0078).';
comment on column public.lodgings.schematic_url is
  'Link to the venue''s floor plan for this building. Set on the building; a room shows its parent''s. Shown to a family once a person is checked in (0078).';

update public.events
   set campus_map_url = 'https://tnbaptist.org/wp-content/uploads/2025/10/carson-springs-map.pdf'
 where id in ('e7e70000-0000-4000-8000-000000000001', 'e7e70000-0000-4000-8000-000000000002')
   and campus_map_url is null;

update public.lodgings l
   set schematic_url = v.url
  from (values
    ('Maple',   'https://tnbaptist.org/wp-content/uploads/2025/10/Maple-Lodge-2017.pdf'),
    ('Pine',    'https://tnbaptist.org/wp-content/uploads/2025/10/Hickory-Pine-Laurel-Lodges-2017.pdf'),
    ('Ginn',    'https://tnbaptist.org/wp-content/uploads/2025/10/Ginn_s-Lodge-2017.pdf'),
    ('Dogwood', 'https://tnbaptist.org/wp-content/uploads/2025/10/Dogwood-Lodge-2017.pdf'),
    ('Cedar',   'https://tnbaptist.org/wp-content/uploads/2025/10/Cedar-Lodge-2017.pdf')
  ) as v(name, url)
 where l.name = v.name
   and l.kind = 'building'
   and l.event_id in ('e7e70000-0000-4000-8000-000000000001', 'e7e70000-0000-4000-8000-000000000002')
   and l.schematic_url is null;

-- Is this participant checked in? Definer, so a policy can ask it without
-- the asker needing to read registration_participants under its own rules.
create or replace function public.participant_checked_in(p_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select rp.checked_in_at is not null
     from public.registration_participants rp
     where rp.id = p_participant_id),
    false);
$$;

grant execute on function public.participant_checked_in(uuid) to authenticated;

-- A bed is visible to its family when the event is published OR the person
-- is checked in.
drop policy if exists lodging_assignments_select on public.lodging_assignments;
create policy lodging_assignments_select on public.lodging_assignments
  for select using (
    public.is_staff()
    or (
      registration_participant_id in (select public.my_participant_ids())
      and (
        public.lodging_published_for(lodging_id)
        or public.participant_checked_in(registration_participant_id)
      )
    )
  );

-- ...and the same rule decides which lodgings (bed + building) they can read.
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
    join public.registration_participants rp on rp.id = a.registration_participant_id
    where a.registration_participant_id in (select public.my_participant_ids())
      and (e.lodging_assignments_published_at is not null or rp.checked_in_at is not null)
  )
  select id from mine
  union
  select parent_id from mine where parent_id is not null;
$$;
