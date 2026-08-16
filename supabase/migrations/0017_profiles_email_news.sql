-- 0017: email preference on the profile.
--
-- One simple choice for now: ministry news & updates (opt-out). Transactional
-- email -- receipts, registration confirmations, password resets -- always
-- sends and is not a preference. profiles already carries sms_opt_in, phone,
-- phone_work; grants and the profiles_update_self policy already cover this
-- column.

alter table public.profiles
  add column if not exists email_news boolean not null default true;
