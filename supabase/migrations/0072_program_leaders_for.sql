-- 0072_program_leaders_for.sql
--
-- Who leads a program at an event, lead first -- readable by the program's own
-- leaders as well as by staff.
--
-- WHY A FUNCTION. Under RLS (0061) a program leader may read only their OWN row
-- in program_leaders, which is the right default: the table records who was
-- granted access to children's names, and one leader has no business browsing
-- it. But 0071 added a lead flag precisely so that people can find "the
-- Children leader", and a leader who cannot see their own co-leader's name
-- defeats that. This SECURITY DEFINER function hands back exactly two columns
-- -- a display name and the lead flag -- and only to somebody who is staff or
-- who leads that same program at that same event. No profile ids, no emails,
-- no grant dates. The same shape as program_roster: the function is the
-- permission, and it is deliberately narrow.
--
-- search_path is pinned (see 0055 for why that matters on a definer function).

create or replace function public.program_leaders_for(p_program_id uuid, p_event_id uuid)
returns table (display_name text, is_lead boolean)
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce(
      nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
      'Someone with an account'
    ) as display_name,
    pl.is_lead
  from public.program_leaders pl
  join public.profiles pr on pr.id = pl.profile_id
  where pl.program_id = p_program_id
    and pl.event_id   = p_event_id
    and pl.active
    and (public.is_staff() or public.leads_program(p_program_id, p_event_id))
  order by pl.is_lead desc, 1;
$$;

comment on function public.program_leaders_for(uuid, uuid) is
  'Names and lead flag of the active leaders of one program at one event. Readable by staff and by that program''s own leaders; returns nothing to anyone else. Two columns on purpose -- see 0072.';

grant execute on function public.program_leaders_for(uuid, uuid) to authenticated;
