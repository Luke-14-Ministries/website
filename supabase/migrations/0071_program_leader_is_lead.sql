-- 0071_program_leader_is_lead.sql
--
-- A program can have more than one leader (0065 says so on purpose: a lead and
-- an assistant), and nothing marked which one was the lead. That mattered to
-- people who are not on the Programs page at all: check-in staff, whoever is
-- driving the golf cart, a parent asking "who runs Children?" -- they need one
-- name, and today they would have to ask. Raised by Lawrence, 1 September 2026.
--
-- ONE BOOLEAN, NOT A ROLE. is_lead changes nothing about what a leader can
-- see or do -- both leaders read the same program_roster view and nothing
-- else. It is a label for humans. Keeping it out of the permission model is
-- deliberate: a "lead" who could see more than an assistant would be a fourth
-- staff role by another name, which 0061 decided against.
--
-- AT MOST ONE LEAD per program per event, enforced by a partial unique index
-- rather than by application code, so two administrators clicking at once
-- cannot produce two leads. Only ACTIVE grants count, so a removed lead does
-- not block naming the next one. Setting a new lead is done in the server
-- action by clearing the old flag first, in one transaction.

alter table public.program_leaders
  add column if not exists is_lead boolean not null default false;

comment on column public.program_leaders.is_lead is
  'Marks the one lead among a program''s leaders at an event. A label for staff and families, not a permission: every leader sees the same roster. At most one active lead per (program_id, event_id), enforced by program_leaders_one_lead_idx.';

create unique index if not exists program_leaders_one_lead_idx
  on public.program_leaders (program_id, event_id)
  where is_lead and active;
