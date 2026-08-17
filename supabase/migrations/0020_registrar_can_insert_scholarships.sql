-- 0020: let registrars CREATE scholarship rows.
-- 0001's insert policy assumed every scholarship starts as a family REQUEST
-- (with_check limited inserts to the family's own participants), and staff
-- then update it. In practice staff grant scholarships directly — often with
-- no request row — and that insert was silently refused, so the audit trail
-- stayed empty while the participant columns updated. Found 17 Aug 2026 when
-- the "who granted this" record came up blank.
-- Applied to production 17 August 2026.

drop policy scholarships_insert on public.scholarships;

create policy scholarships_insert on public.scholarships
  for insert to authenticated
  with check (
    public.is_registrar()
    or registration_participant_id in (select public.my_participant_ids())
  );
