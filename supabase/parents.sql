-- =====================================================================
-- The Little Wings: Parents app + Notices (v2.2). Run AFTER schema.sql.
-- Documentation copy of the SQL that was run on the database. Safe to re-run.
--
-- Security model (additions)
--  * New role 'parent' in public.profiles (created only by the lw-admin Edge
--    Function, never by public sign-up). Login ID = 10-digit mobile number,
--    stored internally as the synthetic email <mobile>@parents.littlewings.app.
--  * public.parent_students links a parent login to one or more children.
--    Parents can read only their own links. Only the server (Edge Function)
--    writes links; the admin can read them all.
--  * Parents get NO direct access to students, attendance, fees, payments,
--    enquiries, staff or settings (RLS returns nothing). They read their own
--    children through two RPCs that return minimal, child-only data:
--       public.parent_children()                    -> id, name, class
--       public.parent_attendance(student, from, to) -> day, status
--    These are SECURITY INVOKER wrappers in public that call SECURITY DEFINER
--    helpers in the private schema "app" (not exposed through the Data API).
--    The helpers check auth.uid() against parent_students, so a parent never
--    receives another child's name or attendance status.
--  * public.notices: admin full; teacher reads school-wide + own class
--    notices, posts only to own class, edits/deletes only their own; parent
--    reads (unexpired) school-wide notices + notices for their children's
--    classes; parents cannot write.
-- =====================================================================

-- ---------- role 'parent' ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'teacher', 'parent'));

-- ---------- parent <-> student links ----------
create table if not exists public.parent_students (
  user_id uuid not null references auth.users (id) on delete cascade,
  student_id text not null references public.students (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, student_id)
);
create index if not exists parent_students_student_idx on public.parent_students (student_id);

-- ---------- notices ----------
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null default '' check (length(body) <= 2000),
  audience text not null default 'all' check (audience in ('all', 'toddlers', 'nursery', 'lkg', 'ukg')),
  pinned boolean not null default false,
  expires_on date,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  author_name text not null default '',
  author_role text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notices_audience_idx on public.notices (audience);
create index if not exists notices_created_at_idx on public.notices (created_at desc);
create index if not exists notices_created_by_idx on public.notices (created_by);

-- ---------- helpers (private schema "app", not exposed) ----------
create or replace function app.is_parent() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'parent' from public.profiles p where p.id = (select auth.uid())), false)
$$;

-- Class ids of the signed-in parent's (non-deleted) children.
create or replace function app.parent_classes() returns setof text
language sql stable security definer set search_path = '' as $$
  select distinct s.class_id
  from public.parent_students ps
  join public.students s on s.id = ps.student_id and not s.deleted
  join public.profiles p on p.id = ps.user_id and p.role = 'parent'
  where ps.user_id = (select auth.uid())
$$;

create or replace function app.parent_children() returns table (id text, name text, class_id text)
language sql stable security definer set search_path = '' as $$
  select s.id, coalesce(nullif(btrim(s.data ->> 'name'), ''), 'Child') as name, s.class_id
  from public.parent_students ps
  join public.students s on s.id = ps.student_id and not s.deleted
  join public.profiles p on p.id = ps.user_id and p.role = 'parent'
  where ps.user_id = (select auth.uid())
  order by 2
$$;

-- Only the given child's own status per day (never the rest of the class row).
create or replace function app.parent_attendance(p_student text, p_from date, p_to date)
returns table (day date, status text)
language sql stable security definer set search_path = '' as $$
  select a.day, a.data ->> p_student as status
  from public.attendance a
  where exists (
          select 1 from public.parent_students ps
          join public.students s on s.id = ps.student_id and not s.deleted
          join public.profiles p on p.id = ps.user_id and p.role = 'parent'
          where ps.user_id = (select auth.uid()) and ps.student_id = p_student)
    and p_from is not null and p_to is not null
    and p_to >= p_from and p_to - p_from <= 400
    and a.day between p_from and p_to
    and not a.deleted
    and a.data ? p_student
    and (a.data ->> p_student) in ('P', 'A', 'L', 'H')
  order by a.day
$$;

revoke all on function app.is_parent(), app.parent_classes(), app.parent_children(), app.parent_attendance(text, date, date) from public, anon;
grant execute on function app.is_parent(), app.parent_classes(), app.parent_children(), app.parent_attendance(text, date, date) to authenticated;

-- ---------- RPCs for the Parents app (SECURITY INVOKER wrappers) ----------
create or replace function public.parent_children() returns table (id text, name text, class_id text)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_children()
$$;
create or replace function public.parent_attendance(p_student text, p_from date, p_to date)
returns table (day date, status text)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_attendance(p_student, p_from, p_to)
$$;
revoke all on function public.parent_children(), public.parent_attendance(text, date, date) from public, anon;
grant execute on function public.parent_children(), public.parent_attendance(text, date, date) to authenticated;

-- ---------- notices: server-side author stamping ----------
create or replace function app.notice_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  pn text; pr text;
begin
  if tg_op = 'INSERT' then
    if me is not null then
      select p.name, p.role into pn, pr from public.profiles p where p.id = me;
      new.created_by := me;
      new.author_name := coalesce(pn, '');
      new.author_role := coalesce(pr, '');
    end if;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.author_name := old.author_name;
    new.author_role := old.author_role;
    new.created_at := old.created_at;
  end if;
  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end $$;
revoke all on function app.notice_stamp() from public, anon, authenticated;
drop trigger if exists notices_stamp on public.notices;
create trigger notices_stamp before insert or update on public.notices
  for each row execute function app.notice_stamp();

-- ---------- settings: staff only (parents do not read school settings) ----------
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to authenticated
  using ((select app.my_role()) in ('admin', 'teacher'));

-- ---------- grants ----------
revoke all on public.parent_students, public.notices from anon;
revoke all on public.parent_students from authenticated;
grant select on public.parent_students to authenticated;
grant select, insert, update, delete on public.notices to authenticated;

-- ---------- RLS ----------
alter table public.parent_students enable row level security;
alter table public.notices enable row level security;

drop policy if exists parent_students_select on public.parent_students;
create policy parent_students_select on public.parent_students for select to authenticated
  using ((select app.is_admin()) or user_id = (select auth.uid()));

drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices for select to authenticated
  using (
    (select app.is_admin())
    or ((select app.my_class()) is not null and (audience = 'all' or audience = (select app.my_class())))
    or ((select app.is_parent())
        and (expires_on is null or expires_on >= (now() at time zone 'Asia/Kolkata')::date)
        and (audience = 'all' or audience in (select app.parent_classes())))
  );
drop policy if exists notices_insert on public.notices;
create policy notices_insert on public.notices for insert to authenticated
  with check (
    (select app.is_admin())
    or (audience = (select app.my_class()) and created_by = (select auth.uid()))
  );
drop policy if exists notices_update on public.notices;
create policy notices_update on public.notices for update to authenticated
  using ((select app.is_admin()) or (created_by = (select auth.uid()) and audience = (select app.my_class())))
  with check ((select app.is_admin()) or (created_by = (select auth.uid()) and audience = (select app.my_class())));
drop policy if exists notices_delete on public.notices;
create policy notices_delete on public.notices for delete to authenticated
  using ((select app.is_admin()) or (created_by = (select auth.uid()) and audience = (select app.my_class())));

-- ---------- auth trigger: allow 'parent' (still server-created only) ----------
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
  if r is null or r not in ('admin', 'teacher', 'parent') then
    raise exception 'Sign-ups are closed. Please ask the school admin to create your login.';
  end if;
  perform pg_advisory_xact_lock(hashtext('lw_admin_bootstrap'));
  if r = 'admin' and exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'An admin account already exists.';
  end if;
  if r in ('teacher', 'parent') and not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'Create the admin account first.';
  end if;
  if r = 'teacher' and (c is null or c not in ('toddlers', 'nursery', 'lkg', 'ukg')) then
    raise exception 'A teacher login needs a class.';
  end if;
  if r = 'parent' and (em is null or em !~ '^[6-9][0-9]{9}@parents\.littlewings\.app$') then
    raise exception 'A parent login must use a 10-digit mobile number.';
  end if;
  insert into public.profiles (id, role, name, email, class_id)
  values (new.id, r, coalesce(meta ->> 'lw_name', ''), em, case when r = 'teacher' then c end);
  return null;
end $$;
revoke all on function app.handle_new_user() from public, anon, authenticated;

-- ---------- updated_at trigger for profiles already exists; realtime ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notices') then
    alter publication supabase_realtime add table public.notices;
  end if;
end $$;
