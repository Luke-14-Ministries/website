-- 0079_lodge_111_and_207.sql
--
-- Lodge 111 and Lodge 207 exist.
--
-- 29 September 2026, from Lawrence: the main Lodge has three floors of twelve
-- hotel-style rooms each, 36 in all. The two rooms missing from Larry's list
-- (0076 deliberately did not invent them) were an omission on the sheet.
-- Added for both Camp Celebrate 2027 weeks, same beds as their neighbours,
-- slotted into the order the venue numbers them. Re-runnable.
--
-- APPLIED to the production project on 29 Sep 2026 (Supabase MCP).

do $$
declare
  ev uuid;
  b uuid;
begin
  foreach ev in array array[
    'e7e70000-0000-4000-8000-000000000001'::uuid,
    'e7e70000-0000-4000-8000-000000000002'::uuid
  ] loop
    select id into b from public.lodgings
     where event_id = ev and kind = 'building' and name = 'Lodge' and active
     limit 1;
    if b is null then continue; end if;

    -- Make room in the order: everything from 112 onward moves down two.
    update public.lodgings set sort_order = sort_order + 2
     where parent_id = b and sort_order >= 21;

    if not exists (select 1 from public.lodgings where parent_id = b and name = 'Lodge 111') then
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, sort_order)
      values (ev, b, 'Lodge 111', 'room', 4, '2 Double beds', 21);
    end if;
    if not exists (select 1 from public.lodgings where parent_id = b and name = 'Lodge 207') then
      insert into public.lodgings (event_id, parent_id, name, kind, capacity, beds, sort_order)
      values (ev, b, 'Lodge 207', 'room', 4, '2 Double beds', 30);
    end if;
  end loop;
end;
$$;
