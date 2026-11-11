-- =====================================================================
-- The Little Wings dashboard v2.6 ("batch 2"). Run AFTER batch1.sql.
-- Documentation copy of the SQL that was run on the database. Safe to re-run.
--
-- Adds
--  * class_posts     homework / "Today we learned" / meal notes per class+day
--                    (teacher: own class, admin: all; parents via parent_posts()).
--  * timetables      one weekly timetable per class (id = class id).
--  * exams, marks    exams/terms + subjects per class, marks/grades + remarks
--                    per student. Only the admin can publish (trigger); parents
--                    see published report cards via parent_report_cards().
--  * vans            transport routes (admin only). Van fee per student lives
--                    in student_fees (van_fee, van_from, van_to) and is added to
--                    dues as its own line. fee_hist keeps old fees after a
--                    year-end promotion so earlier months are not re-priced.
--  * student_docs    admission documents metadata (admin only) + private
--                    bucket "student-docs".
--  * promotions      year-end promotion batches (admin only, for undo).
--  * albums          gallery albums (admin writes; teachers read; parents via
--                    parent_albums()) + private bucket "gallery" (25 MB).
--  * class-media     private bucket for homework photos.
--  * feedback        parent messages (parents insert via parent_feedback_send(),
--                    rate-limited; admin inbox with seen/reply).
--  * audit_log       who changed students, fees, payments, settings (triggers,
--                    admin read only, secrets never logged).
--  * push_subscriptions, push_log   Web Push (Parents app alerts). Sending is
--                    done by the lw-push Edge Function; the VAPID private key is
--                    an Edge Function secret only.
-- =====================================================================

-- ---------- record tables with a class column ----------
do $$
declare t text;
begin
  foreach t in array array['class_posts','timetables','exams','marks'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id text primary key check (length(id) between 1 and 140),
        class_id text not null check (class_id in ('toddlers', 'nursery', 'lkg', 'ukg')),
        data jsonb not null default '{}'::jsonb,
        deleted boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        updated_by uuid
      )$f$, t);
    execute format('create index if not exists %1$s_updated_at_idx on public.%1$I (updated_at)', t);
    execute format('create index if not exists %1$s_class_idx on public.%1$I (class_id)', t);
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before insert or update on public.%1$I for each row execute function app.touch()', t);
    execute format('revoke all on public.%1$I from anon', t);
    execute format('grant select, insert, update, delete on public.%1$I to authenticated', t);
    execute format('alter table public.%1$I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using ((select app.is_admin()) or class_id = (select app.my_class()))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check ((select app.is_admin()) or class_id = (select app.my_class()))', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using ((select app.is_admin()) or class_id = (select app.my_class())) with check ((select app.is_admin()) or class_id = (select app.my_class()))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using ((select app.is_admin()) or class_id = (select app.my_class()))', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
create index if not exists marks_student_idx on public.marks ((data ->> 'studentId'));
create index if not exists marks_exam_idx on public.marks ((data ->> 'examId'));

-- Only the admin can publish / unpublish an exam's report cards.
create or replace function app.exam_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select app.is_admin()) then return new; end if;
  if tg_op = 'INSERT' then
    new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{published}', 'false'::jsonb);
  else
    new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{published}', coalesce(old.data -> 'published', 'false'::jsonb));
  end if;
  return new;
end $$;
revoke all on function app.exam_guard() from public, anon, authenticated;
drop trigger if exists exams_guard on public.exams;
create trigger exams_guard before insert or update on public.exams for each row execute function app.exam_guard();

-- ---------- admin-only record tables ----------
do $$
declare t text;
begin
  foreach t in array array['vans','student_docs','promotions','feedback'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id text primary key check (length(id) between 1 and 64),
        data jsonb not null default '{}'::jsonb,
        deleted boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        updated_by uuid
      )$f$, t);
    execute format('create index if not exists %1$s_updated_at_idx on public.%1$I (updated_at)', t);
    execute format('drop trigger if exists touch_%1$s on public.%1$I', t);
    execute format('create trigger touch_%1$s before insert or update on public.%1$I for each row execute function app.touch()', t);
    execute format('revoke all on public.%1$I from anon', t);
    execute format('grant select, insert, update, delete on public.%1$I to authenticated', t);
    execute format('alter table public.%1$I enable row level security', t);
    execute format('drop policy if exists %1$s_admin_all on public.%1$I', t);
    execute format('create policy %1$s_admin_all on public.%1$I for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()))', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- feedback rows also carry the parent login (set only by parent_feedback_send).
alter table public.feedback add column if not exists parent_id uuid references auth.users (id) on delete cascade;
create index if not exists feedback_parent_idx on public.feedback (parent_id, created_at desc);

-- ---------- albums (class_id null = whole school) ----------
create table if not exists public.albums (
  id text primary key check (length(id) between 1 and 64),
  class_id text check (class_id is null or class_id in ('toddlers', 'nursery', 'lkg', 'ukg')),
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists albums_updated_at_idx on public.albums (updated_at);
drop trigger if exists touch_albums on public.albums;
create trigger touch_albums before insert or update on public.albums for each row execute function app.touch();
revoke all on public.albums from anon;
grant select, insert, update, delete on public.albums to authenticated;
alter table public.albums enable row level security;
drop policy if exists albums_select on public.albums;
create policy albums_select on public.albums for select to authenticated
  using ((select app.is_admin()) or ((select app.my_class()) is not null and (class_id is null or class_id = (select app.my_class()))));
drop policy if exists albums_admin_insert on public.albums;
create policy albums_admin_insert on public.albums for insert to authenticated with check ((select app.is_admin()));
drop policy if exists albums_admin_update on public.albums;
create policy albums_admin_update on public.albums for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
drop policy if exists albums_admin_delete on public.albums;
create policy albums_admin_delete on public.albums for delete to authenticated using ((select app.is_admin()));
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'albums') then
    alter publication supabase_realtime add table public.albums;
  end if;
end $$;

-- ---------- fees: van fee + fee history (kept apart from teachers) ----------
alter table public.student_fees add column if not exists van_fee numeric(12, 2) not null default 0;
alter table public.student_fees add column if not exists van_from text;
alter table public.student_fees add column if not exists van_to text;
alter table public.student_fees add column if not exists fee_hist jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'student_fees_van_chk') then
    alter table public.student_fees add constraint student_fees_van_chk check (
      van_fee >= 0
      and (van_from is null or van_from ~ '^[0-9]{4}-[0-9]{2}$')
      and (van_to is null or van_to ~ '^[0-9]{4}-[0-9]{2}$')
      and jsonb_typeof(fee_hist) = 'array');
  end if;
end $$;

-- Base monthly fee (before sibling discount) for one month. fee_hist entries
-- {until:'YYYY-MM', monthly, yearly, classId} hold the fee used up to that month.
create or replace function app.fee_base_month(p_student text, p_month text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare st record; f record; h jsonb;
begin
  select s.id, s.class_id into st from public.students s where s.id = p_student and not s.deleted;
  if not found then return 0; end if;
  select coalesce(x.monthly_fee, 0) as monthly_fee, coalesce(x.yearly_fee, 0) as yearly_fee, coalesce(x.fee_hist, '[]'::jsonb) as fee_hist
    into f from public.student_fees x where x.student_id = p_student and not x.deleted;
  if not found then return 0; end if;
  if p_month ~ '^[0-9]{4}-[0-9]{2}$' then
    select e into h from jsonb_array_elements(f.fee_hist) e
     where (e ->> 'until') ~ '^[0-9]{4}-[0-9]{2}$' and p_month <= (e ->> 'until')
     order by e ->> 'until' limit 1;
    if h is not null then
      return app.effective_monthly(
        coalesce(nullif(h ->> 'classId', ''), st.class_id),
        case when (h ->> 'monthly') ~ '^[0-9]+(\.[0-9]+)?$' then (h ->> 'monthly')::numeric else 0 end,
        case when (h ->> 'yearly') ~ '^[0-9]+(\.[0-9]+)?$' then (h ->> 'yearly')::numeric else 0 end);
    end if;
  end if;
  return app.effective_monthly(st.class_id, f.monthly_fee, f.yearly_fee);
end $$;

-- Tuition for one month after the optional sibling discount (same rule as v2.5).
create or replace function app.fee_net_month(p_student text, p_month text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare st record; sd jsonb; base numeric; v numeric; ph text[]; older boolean;
begin
  base := app.fee_base_month(p_student, p_month);
  if base <= 0 then return 0; end if;
  select s.id, s.data into st from public.students s where s.id = p_student and not s.deleted;
  select coalesce(x.data, '{}'::jsonb) into sd from public.settings x where x.id = 1 and not x.deleted;
  sd := coalesce(sd, '{}'::jsonb);
  if sd -> 'siblingOn' is distinct from 'true'::jsonb then return base; end if;
  v := case when (sd ->> 'siblingValue') ~ '^[0-9]+(\.[0-9]+)?$' then (sd ->> 'siblingValue')::numeric else 0 end;
  if v <= 0 then return base; end if;
  ph := app.fee_phones(st.data);
  if coalesce(array_length(ph, 1), 0) = 0 then return base; end if;
  select exists (
    select 1 from public.students o
    where not o.deleted and o.id <> st.id
      and coalesce(o.data ->> 'status', '') not in ('Left', 'Inactive')
      and app.fee_phones(o.data) && ph
      and app.fee_order_key(o.id, o.data) collate "C" < app.fee_order_key(st.id, st.data) collate "C"
  ) into older;
  if not older then return base; end if;
  if sd ->> 'siblingType' = 'flat' then return greatest(0, round(base - v, 2)); end if;
  return greatest(0, round(base - base * least(v, 100) / 100.0, 2));
end $$;

-- Van fee for one month (separate line; only while the van dates cover it).
create or replace function app.fee_van_month(p_student text, p_month text) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select round(f.van_fee, 2) from public.student_fees f
    where f.student_id = p_student and not f.deleted and f.van_fee > 0
      and (f.van_from is null or p_month >= f.van_from)
      and (f.van_to is null or p_month <= f.van_to)), 0)
$$;
revoke all on function app.fee_base_month(text, text), app.fee_net_month(text, text), app.fee_van_month(text, text) from public, anon;
grant execute on function app.fee_base_month(text, text), app.fee_net_month(text, text), app.fee_van_month(text, text) to authenticated;

-- parent_fees: per-month tuition (fee history aware) + van fee + late fee.
drop function if exists public.parent_fees(text);
drop function if exists app.parent_fees(text);
create function app.parent_fees(p_student text)
returns table (
  enabled boolean, student_id text, student_name text, class_id text, parent_name text,
  monthly_fee numeric, fees_from text, as_of_month text, months_billed int, months_paid int,
  total_due numeric, this_month_due numeric, total_paid numeric,
  school_name text, school_address text, school_phone text, school_email text,
  late_fee numeric, discount numeric, van_fee numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  st record; sd jsonb; cur text; adm text; fs text; startm text;
  billed int := 0; mpaid int := 0; due numeric := 0; due_now numeric := 0; tpaid numeric := 0; fines numeric := 0;
  m record; st_status text; fine numeric; charge numeric; tu numeric; vn numeric;
begin
  if not app.parent_owns(p_student) then return; end if;
  if not app.parent_fees_enabled() then
    enabled := false; return next; return;
  end if;
  select s.id, s.class_id, s.data into st from public.students s where s.id = p_student and not s.deleted;
  select coalesce(x.data, '{}'::jsonb) into sd from public.settings x where x.id = 1 and not x.deleted;
  sd := coalesce(sd, '{}'::jsonb);
  cur := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
  adm := case when (st.data ->> 'admissionDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then left(st.data ->> 'admissionDate', 7) else cur end;
  fs := case when (sd ->> 'feesStartMonth') ~ '^[0-9]{4}-[0-9]{2}$' then sd ->> 'feesStartMonth' else null end;
  startm := case when fs is not null and fs > adm then fs else adm end;
  select coalesce(sum(b.amount), 0) into tpaid from app.paid_by_month(p_student) b;
  st_status := coalesce(st.data ->> 'status', '');
  if st_status not in ('Left', 'Inactive') and startm <= cur then
    for m in
      select to_char(g, 'YYYY-MM') as ym, coalesce(pb.amount, 0) as paid
      from generate_series(to_date(startm || '-01', 'YYYY-MM-DD'), to_date(cur || '-01', 'YYYY-MM-DD'), interval '1 month') g
      left join app.paid_by_month(p_student) pb on pb.month = to_char(g, 'YYYY-MM')
      limit 600
    loop
      tu := app.fee_net_month(p_student, m.ym);
      if tu <= 0 then continue; end if;
      vn := app.fee_van_month(p_student, m.ym);
      fine := app.fee_month_fine(p_student, m.ym, tu + vn);
      charge := tu + vn + fine;
      fines := fines + fine;
      billed := billed + 1;
      if m.paid >= charge - 0.005 then mpaid := mpaid + 1; end if;
      due := due + greatest(0, charge - m.paid);
      if m.ym = cur then due_now := greatest(0, charge - m.paid); end if;
    end loop;
  end if;
  enabled := true; student_id := st.id; class_id := st.class_id;
  student_name := coalesce(nullif(btrim(st.data ->> 'name'), ''), 'Child');
  parent_name := coalesce(nullif(btrim(st.data ->> 'parentName'), ''),
                          nullif(btrim(st.data ->> 'guardianName'), ''),
                          nullif(btrim(st.data ->> 'motherName'), ''),
                          nullif(btrim(st.data ->> 'fatherName'), ''), '');
  monthly_fee := app.fee_net_month(p_student, cur); fees_from := startm; as_of_month := cur;
  months_billed := billed; months_paid := mpaid; total_due := round(due, 2); this_month_due := round(due_now, 2); total_paid := tpaid;
  school_name := coalesce(nullif(sd ->> 'schoolName', ''), 'The Little Wings Play School');
  school_address := coalesce(sd ->> 'address', '');
  school_phone := coalesce(sd ->> 'phone', '');
  school_email := coalesce(sd ->> 'email', '');
  late_fee := round(fines, 2);
  discount := greatest(0, round(app.fee_base_month(p_student, cur) - app.fee_net_month(p_student, cur), 2));
  van_fee := app.fee_van_month(p_student, cur);
  return next;
end $$;
create function public.parent_fees(p_student text)
returns table (
  enabled boolean, student_id text, student_name text, class_id text, parent_name text,
  monthly_fee numeric, fees_from text, as_of_month text, months_billed int, months_paid int,
  total_due numeric, this_month_due numeric, total_paid numeric,
  school_name text, school_address text, school_phone text, school_email text,
  late_fee numeric, discount numeric, van_fee numeric)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_fees(p_student)
$$;
revoke all on function app.parent_fees(text), public.parent_fees(text) from public, anon;
grant execute on function app.parent_fees(text), public.parent_fees(text) to authenticated;

-- ---------- Parents app RPCs (own child / own child's class only) ----------
create or replace function app.parent_class_of(p_student text) returns text
language sql stable security definer set search_path = '' as $$
  select s.class_id from public.students s where s.id = p_student and not s.deleted and app.parent_owns(p_student)
$$;

create or replace function app.parent_posts(p_student text, p_days int)
returns table (id text, day text, kind text, title text, body text, photo text, author text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.data ->> 'date', coalesce(c.data ->> 'kind', 'Homework'), left(coalesce(c.data ->> 'title', ''), 120),
         left(coalesce(c.data ->> 'text', ''), 2000), c.data ->> 'photo', left(coalesce(c.data ->> 'by', ''), 80), c.updated_at
  from public.class_posts c
  where c.class_id = app.parent_class_of(p_student)
    and not c.deleted
    and (c.data ->> 'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (c.data ->> 'date') >= to_char((now() at time zone 'Asia/Kolkata')::date - least(greatest(coalesce(p_days, 30), 1), 120), 'YYYY-MM-DD')
  order by 2 desc, 8 desc
  limit 300
$$;

create or replace function app.parent_timetable(p_student text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select t.data from public.timetables t
  where t.class_id = app.parent_class_of(p_student) and t.id = t.class_id and not t.deleted
$$;

create or replace function app.parent_report_cards(p_student text)
returns table (exam_id text, exam jsonb, marks jsonb, remarks text, class_id text)
language sql stable security definer set search_path = '' as $$
  select e.id,
         jsonb_build_object('name', e.data ->> 'name', 'term', e.data ->> 'term', 'date', e.data ->> 'date',
                            'year', e.data ->> 'year', 'subjects', coalesce(e.data -> 'subjects', '[]'::jsonb)),
         coalesce(m.data -> 'marks', '{}'::jsonb), left(coalesce(m.data ->> 'remarks', ''), 1000), e.class_id
  from public.exams e
  join public.marks m on m.data ->> 'examId' = e.id and m.data ->> 'studentId' = p_student and not m.deleted
  where app.parent_owns(p_student)
    and not e.deleted and e.data -> 'published' = 'true'::jsonb
  order by e.data ->> 'date' desc nulls last
  limit 50
$$;

create or replace function app.parent_albums()
returns table (id text, class_id text, title text, day text, items jsonb)
language sql stable security definer set search_path = '' as $$
  select a.id, a.class_id, left(coalesce(a.data ->> 'title', 'Album'), 120), a.data ->> 'date', coalesce(a.data -> 'items', '[]'::jsonb)
  from public.albums a
  where (select app.is_parent()) and not a.deleted
    and (a.class_id is null or a.class_id in (select app.parent_classes()))
  order by a.data ->> 'date' desc nulls last, a.created_at desc
  limit 200
$$;

-- Can the signed-in user view this album (storage policy helper)?
create or replace function app.album_visible(p_album text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.albums a
    where a.id = p_album and not a.deleted
      and (
        (select app.is_admin())
        or ((select app.my_class()) is not null and (a.class_id is null or a.class_id = (select app.my_class())))
        or ((select app.is_parent()) and (a.class_id is null or a.class_id in (select app.parent_classes())))
      ))
$$;

-- ---------- parent feedback (rate-limited) ----------
create or replace function app.parent_feedback_send(p_student text, p_message text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); msg text := btrim(coalesce(p_message, '')); n24 int; nmin int; nid text; sname text; pname text;
begin
  if not (select app.is_parent()) or not app.parent_owns(p_student) then raise exception 'Not allowed'; end if;
  if length(msg) < 3 or length(msg) > 1000 then raise exception 'Message must be 3 to 1000 characters'; end if;
  select count(*) filter (where f.created_at > now() - interval '24 hours'),
         count(*) filter (where f.created_at > now() - interval '2 minutes')
    into n24, nmin from public.feedback f where f.parent_id = me;
  if nmin > 0 then raise exception 'Please wait a minute before sending another message'; end if;
  if n24 >= 5 then raise exception 'You can send up to 5 messages a day. Please call the school for anything urgent.'; end if;
  select coalesce(nullif(btrim(s.data ->> 'name'), ''), 'Child') into sname from public.students s where s.id = p_student;
  select coalesce(p.name, '') into pname from public.profiles p where p.id = me;
  nid := 'fb-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.feedback (id, parent_id, data)
  values (nid, me, jsonb_build_object('studentId', p_student, 'studentName', sname, 'parentName', pname,
          'message', msg, 'status', 'New', 'reply', '', 'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  return nid;
end $$;

create or replace function app.parent_feedback_list()
returns table (id text, created_at timestamptz, student_name text, message text, status text, reply text, replied_at text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.created_at, f.data ->> 'studentName', f.data ->> 'message', coalesce(f.data ->> 'status', 'New'),
         coalesce(f.data ->> 'reply', ''), f.data ->> 'repliedAt'
  from public.feedback f
  where f.parent_id = (select auth.uid()) and not f.deleted
  order by f.created_at desc limit 50
$$;

-- ---------- Web Push subscriptions ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 20 and 1000),
  p256dh text not null check (length(p256dh) between 40 and 200),
  auth text not null check (length(auth) between 10 and 100),
  lang text not null default 'en' check (lang in ('en', 'te', 'hi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_ok timestamptz,
  fails int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own_select on public.push_subscriptions;
create policy push_subscriptions_own_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
drop policy if exists push_subscriptions_own_delete on public.push_subscriptions;
create policy push_subscriptions_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function app.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null or (select app.my_role()) is null then raise exception 'Not allowed'; end if;
  if p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/' then
    raise exception 'Unsupported push service';
  end if;
  if p_p256dh !~ '^[A-Za-z0-9_-]{40,200}$' or p_auth !~ '^[A-Za-z0-9_-]{10,100}$' then raise exception 'Bad keys'; end if;
  if (select count(*) from public.push_subscriptions s where s.user_id = me and s.endpoint <> p_endpoint) >= 10 then
    delete from public.push_subscriptions s where s.id in (
      select s2.id from public.push_subscriptions s2 where s2.user_id = me order by s2.updated_at limit 1);
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, lang)
  values (me, p_endpoint, p_p256dh, p_auth, case when p_lang in ('en', 'te', 'hi') then p_lang else 'en' end)
  on conflict (endpoint) do update set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
    lang = excluded.lang, updated_at = now(), fails = 0;
  return true;
end $$;

create or replace function app.push_unsubscribe(p_endpoint text) returns boolean
language sql volatile security definer set search_path = '' as $$
  with d as (delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = (select auth.uid()) returning 1)
  select exists (select 1 from d)
$$;

-- Sent-alert log: de-duplicates alerts (one per event). Edge Function only.
create table if not exists public.push_log (
  id bigint generated always as identity primary key,
  kind text not null,
  ref text not null,
  sent int not null default 0,
  failed int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, ref)
);
revoke all on public.push_log from anon, authenticated;
alter table public.push_log enable row level security;
drop policy if exists push_log_admin_select on public.push_log;
create policy push_log_admin_select on public.push_log for select to authenticated using ((select app.is_admin()));
create index if not exists push_log_created_idx on public.push_log (created_at);

-- ---------- invoker wrappers ----------
create or replace function public.parent_posts(p_student text, p_days int default 30)
returns table (id text, day text, kind text, title text, body text, photo text, author text, updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from app.parent_posts(p_student, p_days) $$;
create or replace function public.parent_timetable(p_student text) returns jsonb
language sql stable security invoker set search_path = '' as $$ select app.parent_timetable(p_student) $$;
create or replace function public.parent_report_cards(p_student text)
returns table (exam_id text, exam jsonb, marks jsonb, remarks text, class_id text)
language sql stable security invoker set search_path = '' as $$ select * from app.parent_report_cards(p_student) $$;
create or replace function public.parent_albums()
returns table (id text, class_id text, title text, day text, items jsonb)
language sql stable security invoker set search_path = '' as $$ select * from app.parent_albums() $$;
create or replace function public.parent_feedback_send(p_student text, p_message text) returns text
language sql volatile security invoker set search_path = '' as $$ select app.parent_feedback_send(p_student, p_message) $$;
create or replace function public.parent_feedback_list()
returns table (id text, created_at timestamptz, student_name text, message text, status text, reply text, replied_at text)
language sql stable security invoker set search_path = '' as $$ select * from app.parent_feedback_list() $$;
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text default 'en') returns boolean
language sql volatile security invoker set search_path = '' as $$ select app.push_subscribe(p_endpoint, p_p256dh, p_auth, p_lang) $$;
create or replace function public.push_unsubscribe(p_endpoint text) returns boolean
language sql volatile security invoker set search_path = '' as $$ select app.push_unsubscribe(p_endpoint) $$;

revoke all on function app.parent_class_of(text), app.parent_posts(text, int), app.parent_timetable(text), app.parent_report_cards(text),
  app.parent_albums(), app.album_visible(text), app.parent_feedback_send(text, text), app.parent_feedback_list(),
  app.push_subscribe(text, text, text, text), app.push_unsubscribe(text) from public, anon;
grant execute on function app.parent_class_of(text), app.parent_posts(text, int), app.parent_timetable(text), app.parent_report_cards(text),
  app.parent_albums(), app.album_visible(text), app.parent_feedback_send(text, text), app.parent_feedback_list(),
  app.push_subscribe(text, text, text, text), app.push_unsubscribe(text) to authenticated;
revoke all on function public.parent_posts(text, int), public.parent_timetable(text), public.parent_report_cards(text), public.parent_albums(),
  public.parent_feedback_send(text, text), public.parent_feedback_list(), public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) from public, anon;
grant execute on function public.parent_posts(text, int), public.parent_timetable(text), public.parent_report_cards(text), public.parent_albums(),
  public.parent_feedback_send(text, text), public.parent_feedback_list(), public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) to authenticated;

-- ---------- storage buckets (all private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('student-docs', 'student-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]),
  ('class-media', 'class-media', false, 2097152, array['image/jpeg']::text[]),
  ('gallery', 'gallery', false, 26214400, array['image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']::text[])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- student-docs: {studentId}/{docId}.{jpg|png|webp|pdf} - admin only.
drop policy if exists student_docs_admin_all on storage.objects;
create policy student_docs_admin_all on storage.objects for all to authenticated
  using (bucket_id = 'student-docs' and (select app.is_admin()))
  with check (bucket_id = 'student-docs' and (select app.is_admin())
              and name ~ '^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,64}\.(jpg|png|webp|pdf)$');

-- class-media: {classId}/{postId}.jpg - teacher own class, admin all; parents read own child's class.
drop policy if exists class_media_staff_select on storage.objects;
create policy class_media_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'class-media' and ((select app.is_admin()) or split_part(name, '/', 1) = (select app.my_class())));
drop policy if exists class_media_staff_insert on storage.objects;
create policy class_media_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'class-media' and name ~ '^(toddlers|nursery|lkg|ukg)/[A-Za-z0-9_-]{1,64}\.jpg$'
              and ((select app.is_admin()) or split_part(name, '/', 1) = (select app.my_class())));
drop policy if exists class_media_staff_update on storage.objects;
create policy class_media_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'class-media' and ((select app.is_admin()) or split_part(name, '/', 1) = (select app.my_class())))
  with check (bucket_id = 'class-media' and name ~ '^(toddlers|nursery|lkg|ukg)/[A-Za-z0-9_-]{1,64}\.jpg$'
              and ((select app.is_admin()) or split_part(name, '/', 1) = (select app.my_class())));
drop policy if exists class_media_staff_delete on storage.objects;
create policy class_media_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'class-media' and ((select app.is_admin()) or split_part(name, '/', 1) = (select app.my_class())));
drop policy if exists class_media_parent_select on storage.objects;
create policy class_media_parent_select on storage.objects for select to authenticated
  using (bucket_id = 'class-media' and (select app.is_parent()) and split_part(name, '/', 1) in (select app.parent_classes()));

-- gallery: {albumId}/{fileId}.{jpg|webp|mp4|webm|mov} - admin writes; viewers per album.
drop policy if exists gallery_admin_write on storage.objects;
create policy gallery_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and (select app.is_admin())
              and name ~ '^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{1,64}\.(jpg|webp|mp4|webm|mov)$');
drop policy if exists gallery_admin_update on storage.objects;
create policy gallery_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'gallery' and (select app.is_admin()))
  with check (bucket_id = 'gallery' and (select app.is_admin()));
drop policy if exists gallery_admin_delete on storage.objects;
create policy gallery_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and (select app.is_admin()));
drop policy if exists gallery_viewer_select on storage.objects;
create policy gallery_viewer_select on storage.objects for select to authenticated
  using (bucket_id = 'gallery' and app.album_visible(split_part(name, '/', 1)));

-- ---------- audit log (admin read only; written by triggers) ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_name text not null default '',
  user_role text not null default '',
  tbl text not null,
  rec text not null default '',
  action text not null,
  summary text not null default ''
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_tbl_at_idx on public.audit_log (tbl, at desc);
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
alter table public.audit_log enable row level security;
drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log for select to authenticated using ((select app.is_admin()));

-- Changed top-level fields as "key: old -> new" (values shortened; secret-like keys skipped).
create or replace function app.audit_diff(o jsonb, n jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(k || ': ' || ov || ' → ' || nv, '; ' order by k), '')
  from (
    select k,
           coalesce(left(case when jsonb_typeof(o -> k) = 'string' then o ->> k else (o -> k)::text end, 40), '∅') as ov,
           coalesce(left(case when jsonb_typeof(n -> k) = 'string' then n ->> k else (n -> k)::text end, 40), '∅') as nv
    from (select jsonb_object_keys(coalesce(o, '{}'::jsonb)) as k union select jsonb_object_keys(coalesce(n, '{}'::jsonb))) keys
    where (o -> k) is distinct from (n -> k)
      and k !~* '(pass|secret|token|otp|pin|auth|key|updated_at|created_at|updated_by)'
    order by k
    limit 15
  ) d
$$;

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid()); o jsonb; n jsonb; rid text; act text; summ text; un text; ur text;
begin
  if tg_op in ('UPDATE', 'DELETE') then o := (to_jsonb(old) - 'data') || coalesce(to_jsonb(old) -> 'data', '{}'::jsonb); end if;
  if tg_op in ('UPDATE', 'INSERT') then n := (to_jsonb(new) - 'data') || coalesce(to_jsonb(new) -> 'data', '{}'::jsonb); end if;
  rid := coalesce(n ->> 'id', o ->> 'id', n ->> 'student_id', o ->> 'student_id', '');
  act := lower(tg_op);
  if tg_op = 'UPDATE' then
    if coalesce((o ->> 'deleted')::boolean, false) = false and coalesce((n ->> 'deleted')::boolean, false) = true then
      act := 'delete';
      summ := coalesce(nullif(left(coalesce(o ->> 'name', o ->> 'receiptNo', o ->> 'studentName', ''), 60), ''), 'record') || ' deleted';
    else
      summ := app.audit_diff(o, n);
      if summ = '' then return null; end if;
    end if;
  elsif tg_op = 'INSERT' then
    summ := app.audit_diff('{}'::jsonb, n);
  else
    summ := app.audit_diff(o, '{}'::jsonb);
  end if;
  select p.name, p.role into un, ur from public.profiles p where p.id = me;
  insert into public.audit_log (user_id, user_name, user_role, tbl, rec, action, summary)
  values (me, coalesce(un, case when me is null then 'system' else '' end), coalesce(ur, ''), tg_table_name, left(rid, 140), act, left(summ, 1500));
  return null;
end $$;
revoke all on function app.audit_diff(jsonb, jsonb), app.audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['students','student_fees','payments','settings'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------- parent_payments: add van_fee (Batch 2 receipts show the van line) ----------
begin;
drop function if exists public.parent_payments(text);
drop function if exists app.parent_payments(text);
create function app.parent_payments(p_student text)
returns table (
  id text, receipt_no text, paid_on text, amount numeric, months text[], mode text, ref text,
  received_by text, balance_after numeric, monthly_fee numeric, student_name text, class_id text, parent_name text, created_at text,
  van_fee numeric)
language sql stable security definer set search_path = '' as $$
  select p.id,
         coalesce(p.data ->> 'receiptNo', ''),
         case when (p.data ->> 'paidOn') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then p.data ->> 'paidOn' else null end,
         case when (p.data ->> 'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.data ->> 'amount')::numeric else 0 end,
         case when jsonb_typeof(p.data -> 'months') = 'array'
              then array(select x from jsonb_array_elements_text(p.data -> 'months') x where x ~ '^[0-9]{4}-[0-9]{2}$' limit 24)
              else array_remove(array[case when (p.data ->> 'month') ~ '^[0-9]{4}-[0-9]{2}$' then p.data ->> 'month' end], null) end,
         left(coalesce(p.data ->> 'mode', ''), 20),
         left(coalesce(p.data ->> 'ref', ''), 60),
         left(coalesce(p.data ->> 'receivedBy', ''), 60),
         case when (p.data ->> 'balanceAfter') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.data ->> 'balanceAfter')::numeric else null end,
         case when (p.data ->> 'monthlyFee') ~ '^[0-9]+(\.[0-9]+)?$' then (p.data ->> 'monthlyFee')::numeric else null end,
         left(coalesce(p.data ->> 'studentName', ''), 80),
         case when (p.data ->> 'classId') in ('toddlers', 'nursery', 'lkg', 'ukg') then p.data ->> 'classId' else null end,
         left(coalesce(p.data ->> 'parentName', ''), 80),
         coalesce(p.data ->> 'createdAt', p.created_at::text),
         case when (p.data ->> 'vanFee') ~ '^[0-9]+(\.[0-9]+)?$' then (p.data ->> 'vanFee')::numeric else null end
  from public.payments p
  where app.parent_owns(p_student)
    and app.parent_fees_enabled()
    and not p.deleted
    and p.data ->> 'studentId' = p_student
  order by coalesce(p.data ->> 'paidOn', '') desc,
           case when (p.data ->> 'seq') ~ '^[0-9]{1,9}$' then (p.data ->> 'seq')::int else 0 end desc
  limit 500
$$;
create function public.parent_payments(p_student text)
returns table (
  id text, receipt_no text, paid_on text, amount numeric, months text[], mode text, ref text,
  received_by text, balance_after numeric, monthly_fee numeric, student_name text, class_id text, parent_name text, created_at text,
  van_fee numeric)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_payments(p_student)
$$;
revoke all on function app.parent_payments(text), public.parent_payments(text) from public, anon;
grant execute on function app.parent_payments(text), public.parent_payments(text) to authenticated;
commit;
