-- 0033_person_photos_visible_to_staff.sql
--
-- 0001 gated identification photos behind can_view_person_support(), grouping
-- them with medical and support detail. Lawrence's decision, 23 Aug 2026: that
-- is the wrong gate for what the photo is FOR.
--
-- The photo is a registration aid and a light identity check at the door --
-- "is this the Tommy I have on the list". The people who need it are exactly
-- the ones working check-in, and most of them are volunteers who do not hold
-- the sensitive grant. A photo nobody at the door can see does not do the job
-- it exists to do.
--
-- The exposure this adds is small and worth naming honestly: any active staff
-- member can now see a headshot of any registered person. They can already see
-- that person's name, age, role, household and phone number on the roster. A
-- face alongside a name they already have is not a new category of disclosure
-- -- whereas a seizure plan beside it would be, and that stays where it is.
--
-- What does NOT change: the storage bucket is still private, every view is
-- still a signed URL that expires within the hour, and nothing is ever
-- published or shown on a public page.

drop policy if exists person_photos_select on public.person_photos;

create policy person_photos_select on public.person_photos
  for select to authenticated
  using (
    exists (
      select 1 from public.people p
      where p.id = person_photos.person_id
        and p.household_id in (select public.my_household_ids())
    )
    or public.is_staff()
  );

-- Writing stays narrower than reading: the family, or a registrar helping them
-- over the phone. A door volunteer who can see a photo still cannot replace it.
drop policy if exists person_photos_write on public.person_photos;

create policy person_photos_write on public.person_photos
  for all to authenticated
  using (
    exists (
      select 1 from public.people p
      where p.id = person_photos.person_id
        and p.household_id in (select public.my_household_ids())
    )
    or public.is_registrar()
  )
  with check (
    exists (
      select 1 from public.people p
      where p.id = person_photos.person_id
        and p.household_id in (select public.my_household_ids())
    )
    or public.is_registrar()
  );

comment on table public.person_photos is
  'Identification photos, used as a registration aid and a light identity check at check-in. Readable by the family and by ANY active staff member (0033) -- deliberately NOT behind the sensitive grant, because the door volunteers who need it rarely hold that grant. Photos of people with disabilities still never leave the ministry: the storage bucket is private and every view is a signed URL that expires within the hour.';
