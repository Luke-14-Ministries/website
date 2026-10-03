-- 0083_create_event.sql
--
-- Events can be created from the admin Setup page (Lawrence, 2 Oct 2026).
-- Until now every event was a migration, so a new camp week meant a developer.
--
-- admin_create_event() makes one event in ONE transaction, optionally copied
-- from an existing one, and always UNPUBLISHED: nothing appears on the public
-- site until an administrator ticks "Visible" on the Setup page.
--
-- What an event needs before registration can work, all created here:
--   * the events row;
--   * the enrollment option (participant_role NULL, the fee) and the zero-fee
--     volunteer second-role option from 0069 -- every money path assumes both
--     (see enrollmentOption() in lib/events.js);
--   * the household agreements (agreement_requirements). Without these a
--     family registers and signs nothing, silently.
--
-- Copying from an existing event also brings, shifted by the difference
-- between the two start dates:
--   * activities and their time slots, with any activity waiver requirement;
--   * for a CAMP only: the rooms and cabins tree (lodgings), no assignments;
--   * for a camp, the volunteer arrival offset (volunteers come a day early).
-- Never copied: registrations, assignments, program leaders (people change
-- year to year), the medical contact, publish flags, early-registration dates.
--
-- Agreements always attach to the CURRENT active version of each key, so a
-- copy from an event set up before a wording change still gets today's text.
--
-- Event types offered on the form: camp_week ("Camp") and retreat. The
-- constraint also allows dinner and other; those behave like a retreat
-- (no rooms, buddies or programs -- staffAssigns() in lib/events.js).
--
-- APPLIED to the production project on 2 Oct 2026 (Supabase MCP).

create or replace function public.admin_create_event(
  p_name          text,
  p_event_type    text,
  p_starts_on     date,
  p_ends_on       date,
  p_fee_cents     integer,
  p_deposit_cents integer,
  p_capacity      integer default null,
  p_location      text    default null,
  p_copy_from     uuid    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_src   public.events%rowtype;
  v_shift integer := 0;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then
    raise exception 'Only administrators can create events.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'An event needs a name.';
  end if;
  if p_event_type not in ('camp_week', 'retreat', 'dinner', 'other') then
    raise exception 'Unknown event type: %', p_event_type;
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'Check the dates: the last day must be on or after the first.';
  end if;
  if coalesce(p_fee_cents, -1) < 0 or coalesce(p_deposit_cents, -1) < 0 then
    raise exception 'Price and deposit must be zero or more.';
  end if;
  if p_capacity is not null and p_capacity < 0 then
    raise exception 'Capacity must be zero or more, or blank.';
  end if;

  if p_copy_from is not null then
    select * into v_src from public.events where id = p_copy_from;
    if not found then
      raise exception 'The event to copy from no longer exists.';
    end if;
    v_shift := p_starts_on - v_src.starts_on;
  end if;

  -- 1. The event. Volunteers on a camp arrive a day early (30 Sep 2026); a
  --    copy keeps its source's offset instead.
  insert into public.events (
    name, event_type, description, starts_on, ends_on, deposit_cents, location,
    capacity, published, campus_map_url, volunteer_arrives_on
  ) values (
    v_name, p_event_type,
    case when p_copy_from is not null then v_src.description end,
    p_starts_on, p_ends_on, p_deposit_cents,
    coalesce(nullif(btrim(p_location), ''), case when p_copy_from is not null then v_src.location end),
    p_capacity, false,
    case when p_copy_from is not null then v_src.campus_map_url end,
    case
      when p_event_type <> 'camp_week' then null
      when p_copy_from is not null and v_src.volunteer_arrives_on is not null
        then v_src.volunteer_arrives_on + v_shift
      else p_starts_on - 1
    end
  )
  returning id into v_id;

  -- 2. The two options every event needs.
  insert into public.event_options (event_id, name, description, participant_role, fee_cents,
                                    deposit_cents, published, sort_order)
  values
    (v_id, v_name || ' Enrollment', null, null, p_fee_cents, p_deposit_cents, true, 1),
    (v_id, 'Volunteer (second role, no extra fee)',
     'For someone already registered for this event in another role who is also volunteering. Their fee is charged once, on their first role.',
     'volunteer', 0, 0, true, 100);

  -- 3. Activities and slots (copy only), dates moved with the event.
  -- Old-id -> new-id maps live in temp tables for this transaction only.
  if to_regclass('pg_temp._ace_activity_map') is null then
    create temp table _ace_activity_map (old_id uuid, new_id uuid) on commit drop;
  end if;
  delete from _ace_activity_map;
  if p_copy_from is not null then
    insert into _ace_activity_map (old_id, new_id)
    select id, gen_random_uuid() from public.activities where event_id = p_copy_from;

    insert into public.activities (id, event_id, name, description, booking_mode, capacity,
                                   fee_cents, provider_name, provider_url, signup_opens_at,
                                   signup_closes_at, active, sort_order)
    select m.new_id, v_id, a.name, a.description, a.booking_mode, a.capacity, a.fee_cents,
           a.provider_name, a.provider_url,
           a.signup_opens_at + make_interval(days => v_shift),
           a.signup_closes_at + make_interval(days => v_shift),
           a.active, a.sort_order
      from public.activities a
      join _ace_activity_map m on m.old_id = a.id;

    insert into public.activity_slots (activity_id, starts_at, ends_at, capacity, label,
                                       slot_date, start_time, end_time)
    select m.new_id,
           s.starts_at + make_interval(days => v_shift),
           s.ends_at + make_interval(days => v_shift),
           s.capacity, s.label, s.slot_date + v_shift, s.start_time, s.end_time
      from public.activity_slots s
      join _ace_activity_map m on m.old_id = s.activity_id;
  end if;

  -- 4. Agreements: the source's set (activity waivers re-pointed at the new
  --    activities), or the standard household four for a blank event --
  --    always at the current active version.
  if p_copy_from is not null then
    insert into public.agreement_requirements (agreement_id, event_id, activity_id, applies_to,
                                               is_required, due_on)
    select cur.id, v_id, m.new_id, r.applies_to, r.is_required, r.due_on + v_shift
      from public.agreement_requirements r
      join public.agreements old on old.id = r.agreement_id
      join lateral (
        select a.id from public.agreements a
         where a.key = old.key and a.active
         order by a.version desc limit 1
      ) cur on true
      left join _ace_activity_map m on m.old_id = r.activity_id
     where r.event_id = p_copy_from
       and (r.activity_id is null or m.new_id is not null);
  else
    insert into public.agreement_requirements (agreement_id, event_id, applies_to, is_required)
    select distinct on (a.key) a.id, v_id, 'household', true
      from public.agreements a
     where a.active
       and a.key in ('emergency_consent', 'hold_harmless', 'event_rules', 'communication_consent')
     order by a.key, a.version desc;
  end if;

  -- 5. Rooms and cabins: camps only, copy only. Parents first, then children,
  --    through a map so each child points at its NEW parent.
  if p_copy_from is not null and p_event_type = 'camp_week' then
    if to_regclass('pg_temp._ace_lodging_map') is null then
      create temp table _ace_lodging_map (old_id uuid, new_id uuid) on commit drop;
    end if;
    delete from _ace_lodging_map;
    insert into _ace_lodging_map (old_id, new_id)
    select id, gen_random_uuid() from public.lodgings where event_id = p_copy_from;

    insert into public.lodgings (id, event_id, parent_id, name, kind, capacity, accessible,
                                 accessible_notes, notes, sort_order, active, beds,
                                 staff_capacity, schematic_url)
    select m.new_id, v_id, null, l.name, l.kind, l.capacity, l.accessible, l.accessible_notes,
           l.notes, l.sort_order, l.active, l.beds, l.staff_capacity, l.schematic_url
      from public.lodgings l
      join _ace_lodging_map m on m.old_id = l.id;

    update public.lodgings child
       set parent_id = pm.new_id
      from _ace_lodging_map cm, public.lodgings src, _ace_lodging_map pm
     where child.id = cm.new_id
       and src.id = cm.old_id
       and src.parent_id is not null
       and pm.old_id = src.parent_id;
  end if;

  return v_id;
end;
$$;

comment on function public.admin_create_event(text, text, date, date, integer, integer, integer, text, uuid) is
  'Admin-only. Creates an UNPUBLISHED event with its enrollment + volunteer options and household agreements; optionally copies activities, waivers and (camps) rooms from another event, shifted to the new dates. 0083, 2 Oct 2026.';

revoke execute on function public.admin_create_event(text, text, date, date, integer, integer, integer, text, uuid) from public, anon;
grant execute on function public.admin_create_event(text, text, date, date, integer, integer, integer, text, uuid) to authenticated;
