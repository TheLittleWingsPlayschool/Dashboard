-- =====================================================================
-- The Little Wings Play School dashboard: Supabase schema (v2)
-- Project: little-wings-dashboard (ap-south-1). Documentation copy of the
-- SQL that was run on the database. Safe to re-run on an empty project.
--
-- Security model
--  * Every public table has Row Level Security enabled.
--  * Roles live in public.profiles (written only by the server: the auth
--    trigger below and the lw-admin Edge Function). user_metadata is never
--    used for authorisation.
--  * Admin: full access. Teacher: reads/writes students and attendance of
--    their own class only. Teachers can never read student_fees, payments,
--    enquiries or staff (salaries).
--  * Helper functions are SECURITY DEFINER but live in the private schema
--    "app", which is not exposed through the Data API.
--  * Public sign-ups are rejected by the auth trigger. Accounts are created
--    only by the lw-admin Edge Function (first admin once, then teachers by
--    the admin).
-- v2.2: run supabase/parents.sql after this file (parent role, parent_students,
-- notices, parent-only RPCs). It also replaces app.handle_new_user and the
-- settings_select policy defined below.
-- v2.3: then run supabase/receipts.sql (parent_fees / parent_payments RPCs for
-- the Parents app Fees tab, gated by settings.data.showFeesToParents).
-- =====================================================================

create schema if not exists app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

-- ---------- profiles (role per auth user) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'teacher')),
  name text not null default '',
  email text,
  class_id text check (class_id is null or class_id in ('toddlers', 'nursery', 'lkg', 'ukg')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- data tables: one row per record, key columns + jsonb ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.students (
  id text primary key check (length(id) between 1 and 64),
  class_id text not null check (class_id in ('toddlers', 'nursery', 'lkg', 'ukg')),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Monthly fee is kept apart from the student row so teachers never receive it.
create table if not exists public.student_fees (
  student_id text primary key check (length(student_id) between 1 and 64),
  monthly_fee numeric(12, 2) not null default 0 check (monthly_fee >= 0),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- One row per day per class; data = { "<studentId>": "P|A|L|H", ... }
create table if not exists public.attendance (
  day date not null,
  class_id text not null check (class_id in ('toddlers', 'nursery', 'lkg', 'ukg')),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (day, class_id)
);

create table if not exists public.payments (
  id text primary key check (length(id) between 1 and 64),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.enquiries (
  id text primary key check (length(id) between 1 and 64),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.staff (
  id text primary key check (length(id) between 1 and 64),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists students_updated_at_idx on public.students (updated_at);
create index if not exists students_class_idx on public.students (class_id);
create index if not exists student_fees_updated_at_idx on public.student_fees (updated_at);
create index if not exists attendance_updated_at_idx on public.attendance (updated_at);
create index if not exists attendance_class_idx on public.attendance (class_id);
create index if not exists payments_updated_at_idx on public.payments (updated_at);
create index if not exists enquiries_updated_at_idx on public.enquiries (updated_at);
create index if not exists staff_updated_at_idx on public.staff (updated_at);
create index if not exists settings_updated_at_idx on public.settings (updated_at);

-- ---------- helper functions (private schema) ----------
create or replace function app.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'admin' from public.profiles p where p.id = (select auth.uid())), false)
$$;

create or replace function app.my_class() returns text
language sql stable security definer set search_path = '' as $$
  select p.class_id from public.profiles p where p.id = (select auth.uid()) and p.role = 'teacher'
$$;

revoke all on function app.my_role(), app.is_admin(), app.my_class() from public, anon;
grant execute on function app.my_role(), app.is_admin(), app.my_class() to authenticated;

-- updated_at / updated_by maintained by the server, never trusted from the client
create or replace function app.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_table_name <> 'profiles' then
    new.updated_by := (select auth.uid());
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke all on function app.touch() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles','settings','students','student_fees','attendance','payments','enquiries','staff'] loop
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before insert or update on public.%1$I for each row execute function app.touch()', t);
  end loop;
end $$;

-- ---------- auth: create profile from server-set app_metadata; block public sign-ups ----------
-- GoTrue inserts the user row first and writes app_metadata later in the same
-- transaction, so this runs as a DEFERRED constraint trigger (at commit) and
-- re-reads the final row. Raising here rolls back the whole sign-up.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb;
  em text;
  r text;
  c text;
begin
  select u.raw_app_meta_data, u.email into meta, em from auth.users u where u.id = new.id;
  if not found then return null; end if;
  if exists (select 1 from public.profiles where id = new.id) then return null; end if;
  r := meta ->> 'lw_role';
  c := nullif(meta ->> 'lw_class', '');
  if r is null or r not in ('admin', 'teacher') then
    raise exception 'Sign-ups are closed. Please ask the school admin to create your login.';
  end if;
  perform pg_advisory_xact_lock(hashtext('lw_admin_bootstrap'));
  if r = 'admin' and exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'An admin account already exists.';
  end if;
  if r = 'teacher' and not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Create the admin account first.';
  end if;
  if r = 'teacher' and (c is null or c not in ('toddlers', 'nursery', 'lkg', 'ukg')) then
    raise exception 'A teacher login needs a class.';
  end if;
  insert into public.profiles (id, role, name, email, class_id)
  values (new.id, r, coalesce(meta ->> 'lw_name', ''), em, case when r = 'teacher' then c end);
  return null;
end $$;
revoke all on function app.handle_new_user() from public, anon, authenticated;

drop trigger if exists lw_on_auth_user_created on auth.users;
create constraint trigger lw_on_auth_user_created
  after insert on auth.users
  deferrable initially deferred
  for each row execute function app.handle_new_user();

-- ---------- grants ----------
revoke all on public.profiles, public.settings, public.students, public.student_fees,
  public.attendance, public.payments, public.enquiries, public.staff from anon;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.settings, public.students, public.student_fees,
  public.attendance, public.payments, public.enquiries, public.staff to authenticated;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.students enable row level security;
alter table public.student_fees enable row level security;
alter table public.attendance enable row level security;
alter table public.payments enable row level security;
alter table public.enquiries enable row level security;
alter table public.staff enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()));

-- settings: everyone signed in with a role can read; only admin writes
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using ((select app.my_role()) is not null);
drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings for insert to authenticated
  with check ((select app.is_admin()));
drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
drop policy if exists settings_delete on public.settings;
create policy settings_delete on public.settings for delete to authenticated
  using ((select app.is_admin()));

-- students: admin all; teacher own class (no soft-delete, no hard delete)
drop policy if exists students_select on public.students;
create policy students_select on public.students for select to authenticated
  using ((select app.is_admin()) or class_id = (select app.my_class()));
drop policy if exists students_insert on public.students;
create policy students_insert on public.students for insert to authenticated
  with check ((select app.is_admin()) or (class_id = (select app.my_class()) and not deleted));
drop policy if exists students_update on public.students;
create policy students_update on public.students for update to authenticated
  using ((select app.is_admin()) or class_id = (select app.my_class()))
  with check ((select app.is_admin()) or (class_id = (select app.my_class()) and not deleted));
drop policy if exists students_delete on public.students;
create policy students_delete on public.students for delete to authenticated
  using ((select app.is_admin()));

-- attendance: admin all; teacher own class
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated
  using ((select app.is_admin()) or class_id = (select app.my_class()));
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance for insert to authenticated
  with check ((select app.is_admin()) or (class_id = (select app.my_class()) and not deleted));
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance for update to authenticated
  using ((select app.is_admin()) or class_id = (select app.my_class()))
  with check ((select app.is_admin()) or (class_id = (select app.my_class()) and not deleted));
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance for delete to authenticated
  using ((select app.is_admin()));

-- admin-only tables: fees, payments, enquiries, staff
do $$
declare t text;
begin
  foreach t in array array['student_fees','payments','enquiries','staff'] loop
    execute format('drop policy if exists %1$s_admin_all on public.%1$I', t);
    execute format('create policy %1$s_admin_all on public.%1$I for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()))', t);
  end loop;
end $$;

-- ---------- realtime (RLS still applies to change events) ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','settings','students','student_fees','attendance','payments','enquiries','staff'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
