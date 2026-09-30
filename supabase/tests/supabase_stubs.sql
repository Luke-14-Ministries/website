-- Minimal stand-ins for the Supabase pieces the migrations expect (auth.uid(),
-- roles, storage), so every migration can run on a plain local Postgres. Tests only.
create schema auth; create schema extensions; create schema storage;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), phone text, email_confirmed_at timestamptz, last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, jsonb_build_object('aal', coalesce(nullif(current_setting('request.jwt.claim.aal', true),''),'aal1'))) $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
create extension if not exists pgcrypto;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
