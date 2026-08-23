-- 0032_person_photos_storage.sql
--
-- Identification photos. CampSite blocks enrolment until one is uploaded; we
-- ask for one on the support-details form and do not block, because a family
-- without a good photo to hand should still be able to secure a place.
--
-- The TABLE (person_photos) and its policies have existed since 0001. What was
-- missing was somewhere to put the actual file. This creates the bucket and
-- the storage policies that mirror the table's rules.
--
-- Three decisions worth keeping:
--
--   PRIVATE bucket. Reading a photo needs a signed URL minted server-side for
--   someone whose row-level security already allows it, so a leaked path is
--   not a leaked photograph of a person with a disability.
--
--   512KB ceiling and image/jpeg only. The browser resizes every photo to a
--   512x512 square JPEG at quality 0.8 before upload -- roughly 40-60KB -- so
--   storage stays predictable whether the source was a phone camera or a
--   scan, and a roster of thumbnails loads over camp wifi. The ceiling is a
--   backstop against a client that skips the resize, not the mechanism.
--
--   Path convention IS the access rule. A photo lives at
--   <person_id>/photo.jpg, so the first path segment identifies the person and
--   can_touch_person_photo() turns that into the same household check every
--   other family-facing table uses. One object per person, overwritten on
--   replacement, so repeated uploads leave no orphans.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('person-photos', 'person-photos', false, 524288, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_touch_person_photo(p_path text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    -- Guard the cast. A malformed path must return FALSE, not raise: an
    -- exception inside a storage policy aborts the whole request with a
    -- database error instead of a clean "not permitted".
    when split_part(p_path, '/', 1) !~ '^[0-9a-fA-F-]{36}$' then false
    else exists (
      select 1 from public.people p
      where p.id = (split_part(p_path, '/', 1))::uuid
        and p.household_id in (select public.my_household_ids())
    )
  end;
$$;

comment on function public.can_touch_person_photo(text) is
  'A photo lives at <person_id>/<filename>.jpg, so the first path segment IS the person. This turns that convention into the same household check every other family-facing table uses. A path whose first segment is not a uuid returns false rather than raising.';

-- Families reach their own household's photos; staff reach all of them. Staff
-- READS are additionally narrowed by person_photos' own select policy, which
-- 0001 put behind can_view_person_support -- identification photos of campers
-- with disabilities sit with medical and support detail, not with the roster.
create policy "person photos: family reads own"
  on storage.objects for select to authenticated
  using (bucket_id = 'person-photos' and public.can_touch_person_photo(name));

create policy "person photos: staff read all"
  on storage.objects for select to authenticated
  using (bucket_id = 'person-photos' and public.is_staff());

create policy "person photos: family writes own"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'person-photos' and public.can_touch_person_photo(name));

create policy "person photos: family replaces own"
  on storage.objects for update to authenticated
  using (bucket_id = 'person-photos' and public.can_touch_person_photo(name))
  with check (bucket_id = 'person-photos' and public.can_touch_person_photo(name));

create policy "person photos: family deletes own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'person-photos' and public.can_touch_person_photo(name));
