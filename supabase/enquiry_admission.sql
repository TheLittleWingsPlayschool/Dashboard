-- =====================================================================
-- The Little Wings: enquiries, admission fields, student photos, yearly
-- fee (v2.4). Run AFTER schema.sql, parents.sql and receipts.sql.
-- Documentation copy of the SQL that was run on the database. Safe to re-run.
--
-- Security model (additions)
--  * public.enquiries stays admin-only (unchanged). Teachers and parents
--    still get 0 rows. Verified after apply.
--  * public.student_fees gains yearly_fee (admin-only, same RLS as monthly
--    fee). Teachers never receive fee columns. Parents still read fees only
--    through parent_fees() when "Show fees to parents" is on.
--  * New private Storage bucket "student-photos" (public = false). Objects
--    live at {student_id}/photo.jpg. Access is only via signed URLs:
--       admin: full (select/insert/update/delete)
--       teacher: select only, and only photos of students in their class
--       parent: select only, and only their own linked child's photo
--    The bucket is never public. Upsert needs INSERT + SELECT + UPDATE.
--  * public.parent_children() also returns section, status and photo_path
--    (the storage path, never a public URL). Parents create a short-lived
--    signed URL themselves; RLS decides whether that succeeds.
--  * app.parent_fees() now treats status 'Inactive' like 'Left' (no dues)
--    and uses the same effective monthly fee as the dashboard: an explicit
--    nursery monthly fee if set, otherwise yearly_fee/12, otherwise the
--    stored monthly fee (legacy students). Stored payments are not rewritten.
-- =====================================================================

-- ---------- yearly fee (admin-only table; teachers never see this) ----------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'student_fees' and column_name = 'yearly_fee'
  ) then
    alter table public.student_fees
      add column yearly_fee numeric(12, 2) not null default 0
      constraint student_fees_yearly_fee_check check (yearly_fee >= 0);
  end if;
end $$;

-- Effective monthly fee used for dues and display when no explicit monthly
-- is stored (or, for Nursery, when the optional monthly field is empty).
create or replace function app.effective_monthly(p_class text, p_monthly numeric, p_yearly numeric)
returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_class = 'nursery' and coalesce(p_monthly, 0) > 0 then round(coalesce(p_monthly, 0), 2)
    when coalesce(p_yearly, 0) > 0 then round(p_yearly / 12.0, 2)
    else round(coalesce(p_monthly, 0), 2)
  end
$$;
revoke all on function app.effective_monthly(text, numeric, numeric) from public, anon;
grant execute on function app.effective_monthly(text, numeric, numeric) to authenticated;

-- ---------- parent_children: section, status, photo path ----------
drop function if exists public.parent_children();
drop function if exists app.parent_children();

create function app.parent_children()
returns table (id text, name text, class_id text, section text, status text, photo_path text)
language sql stable security definer set search_path = '' as $$
  select s.id,
         coalesce(nullif(btrim(s.data ->> 'name'), ''), 'Child') as name,
         s.class_id,
         left(coalesce(nullif(btrim(s.data ->> 'section'), ''), ''), 16) as section,
         case
           when coalesce(s.data ->> 'status', '') in ('Left', 'Inactive') then 'Inactive'
           else 'Active'
         end as status,
         case
           when (s.data ->> 'photoPath') ~ '^[A-Za-z0-9_-]{1,64}/photo\.jpg$'
             then s.data ->> 'photoPath'
           else null
         end as photo_path
  from public.parent_students ps
  join public.students s on s.id = ps.student_id and not s.deleted
  join public.profiles p on p.id = ps.user_id and p.role = 'parent'
  where ps.user_id = (select auth.uid())
  order by 2
$$;

create function public.parent_children()
returns table (id text, name text, class_id text, section text, status text, photo_path text)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_children()
$$;

revoke all on function app.parent_children(), public.parent_children() from public, anon;
grant execute on function app.parent_children(), public.parent_children() to authenticated;

-- ---------- parent_fees: Inactive excluded; effective monthly fee ----------
create or replace function app.parent_fees(p_student text)
returns table (
  enabled boolean, student_id text, student_name text, class_id text, parent_name text,
  monthly_fee numeric, fees_from text, as_of_month text, months_billed int, months_paid int,
  total_due numeric, this_month_due numeric, total_paid numeric,
  school_name text, school_address text, school_phone text, school_email text)
language plpgsql stable security definer set search_path = '' as $$
declare
  st record; sd jsonb; fee numeric; mon numeric; yr numeric; cur text; adm text; fs text; startm text;
  billed int := 0; mpaid int := 0; due numeric := 0; due_now numeric := 0; tpaid numeric := 0;
  m record; st_status text;
begin
  if not app.parent_owns(p_student) then return; end if;
  if not app.parent_fees_enabled() then
    enabled := false; return next; return;
  end if;
  select s.id, s.class_id, s.data into st from public.students s where s.id = p_student and not s.deleted;
  select coalesce(x.data, '{}'::jsonb) into sd from public.settings x where x.id = 1 and not x.deleted;
  sd := coalesce(sd, '{}'::jsonb);
  select coalesce((select f.monthly_fee from public.student_fees f where f.student_id = p_student and not f.deleted), 0),
         coalesce((select f.yearly_fee from public.student_fees f where f.student_id = p_student and not f.deleted), 0)
    into mon, yr;
  fee := app.effective_monthly(st.class_id, mon, yr);
  cur := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
  adm := case when (st.data ->> 'admissionDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then left(st.data ->> 'admissionDate', 7) else cur end;
  fs := case when (sd ->> 'feesStartMonth') ~ '^[0-9]{4}-[0-9]{2}$' then sd ->> 'feesStartMonth' else null end;
  startm := case when fs is not null and fs > adm then fs else adm end;
  select coalesce(sum(b.amount), 0) into tpaid from app.paid_by_month(p_student) b;
  st_status := coalesce(st.data ->> 'status', '');
  if st_status not in ('Left', 'Inactive') and fee > 0 and startm <= cur then
    for m in
      select to_char(g, 'YYYY-MM') as ym, coalesce(pb.amount, 0) as paid
      from generate_series(to_date(startm || '-01', 'YYYY-MM-DD'), to_date(cur || '-01', 'YYYY-MM-DD'), interval '1 month') g
      left join app.paid_by_month(p_student) pb on pb.month = to_char(g, 'YYYY-MM')
      limit 600
    loop
      billed := billed + 1;
      if m.paid >= fee then mpaid := mpaid + 1; end if;
      due := due + greatest(0, fee - m.paid);
      if m.ym = cur then due_now := greatest(0, fee - m.paid); end if;
    end loop;
  end if;
  enabled := true; student_id := st.id; class_id := st.class_id;
  student_name := coalesce(nullif(btrim(st.data ->> 'name'), ''), 'Child');
  parent_name := coalesce(nullif(btrim(st.data ->> 'parentName'), ''),
                          nullif(btrim(st.data ->> 'guardianName'), ''),
                          nullif(btrim(st.data ->> 'motherName'), ''),
                          nullif(btrim(st.data ->> 'fatherName'), ''), '');
  monthly_fee := fee; fees_from := startm; as_of_month := cur;
  months_billed := billed; months_paid := mpaid; total_due := due; this_month_due := due_now; total_paid := tpaid;
  school_name := coalesce(nullif(sd ->> 'schoolName', ''), 'The Little Wings Play School');
  school_address := coalesce(sd ->> 'address', '');
  school_phone := coalesce(sd ->> 'phone', '');
  school_email := coalesce(sd ->> 'email', '');
  return next;
end $$;

-- ---------- private student photo bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('student-photos', 'student-photos', false, 1048576, array['image/jpeg']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path must be {student_id}/photo.jpg (one folder, jpeg only).
create or replace function app.photo_student_id(object_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when object_name ~ '^[A-Za-z0-9_-]{1,64}/photo\.jpg$'
      then split_part(object_name, '/', 1)
    else null
  end
$$;
revoke all on function app.photo_student_id(text) from public, anon;
grant execute on function app.photo_student_id(text) to authenticated;

drop policy if exists student_photos_admin_select on storage.objects;
drop policy if exists student_photos_admin_insert on storage.objects;
drop policy if exists student_photos_admin_update on storage.objects;
drop policy if exists student_photos_admin_delete on storage.objects;
drop policy if exists student_photos_teacher_select on storage.objects;
drop policy if exists student_photos_parent_select on storage.objects;

create policy student_photos_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'student-photos' and (select app.is_admin()));

create policy student_photos_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-photos'
    and (select app.is_admin())
    and app.photo_student_id(name) is not null
  );

create policy student_photos_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'student-photos' and (select app.is_admin()))
  with check (
    bucket_id = 'student-photos'
    and (select app.is_admin())
    and app.photo_student_id(name) is not null
  );

create policy student_photos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-photos' and (select app.is_admin()));

create policy student_photos_teacher_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-photos'
    and (select app.my_class()) is not null
    and exists (
      select 1 from public.students s
      where s.id = app.photo_student_id(name)
        and s.class_id = (select app.my_class())
        and not s.deleted
    )
  );

create policy student_photos_parent_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-photos'
    and (select app.is_parent())
    and (select app.parent_owns(app.photo_student_id(name)))
  );
