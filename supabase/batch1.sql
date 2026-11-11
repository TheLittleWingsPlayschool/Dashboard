-- =====================================================================
-- The Little Wings dashboard v2.5 ("batch 1"). Run AFTER schema.sql,
-- parents.sql, receipts.sql and enquiry_admission.sql. Documentation copy of
-- the SQL that was run on the database. Safe to re-run.
--
-- Adds
--  * holidays          admin writes; admin + teachers read (attendance skips
--                      holidays); parents read only via parent_holidays().
--  * expenses          admin only (rent, stationery, snacks, ...).
--  * salaries          admin only (salary paid per staff member per month).
--  * staff_attendance  admin only (one row per day: { staffId: 'P'|'A'|'H' }).
--  * fee_reminders     admin only (one row per student: last WhatsApp reminder).
--  * web_enquiry_hits  rate-limit log for the public website enquiry form.
--                      Written only by the lw-enquiry Edge Function (service
--                      role, server side). No grants to anon/authenticated.
--  * Fee rules (off by default, stored in settings.data):
--       siblingOn, siblingType ('pct'|'flat'), siblingValue
--       lateFeeOn, lateFeeType ('flat'|'day'), lateFeeAmount, lateFeeMax,
--       feeDueDay (1-28, default 10), lateFeeFrom ('YYYY-MM')
--    app.parent_fees() now applies them exactly like the dashboard. Stored
--    payments are never rewritten.
--
-- Security model: unchanged. Teachers can never read expenses, salaries,
-- staff attendance, fee reminders, payments, fees, enquiries or staff.
-- SECURITY DEFINER helpers live in the private schema "app".
-- =====================================================================

-- ---------- tables (same shape as the other record tables) ----------
do $$
declare t text;
begin
  foreach t in array array['holidays','expenses','salaries','staff_attendance','fee_reminders'] loop
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
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- admin-only tables
do $$
declare t text;
begin
  foreach t in array array['expenses','salaries','staff_attendance','fee_reminders'] loop
    execute format('drop policy if exists %1$s_admin_all on public.%1$I', t);
    execute format('create policy %1$s_admin_all on public.%1$I for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()))', t);
  end loop;
end $$;

-- holidays: admin + teachers read, admin writes
drop policy if exists holidays_select on public.holidays;
create policy holidays_select on public.holidays for select to authenticated
  using ((select app.my_role()) in ('admin', 'teacher'));
drop policy if exists holidays_insert on public.holidays;
create policy holidays_insert on public.holidays for insert to authenticated
  with check ((select app.is_admin()));
drop policy if exists holidays_update on public.holidays;
create policy holidays_update on public.holidays for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
drop policy if exists holidays_delete on public.holidays;
create policy holidays_delete on public.holidays for delete to authenticated
  using ((select app.is_admin()));

-- ---------- parents: read-only "Holidays & events" ----------
create or replace function app.parent_holidays()
returns table (id text, date_from text, date_to text, title text, kind text)
language sql stable security definer set search_path = '' as $$
  select h.id,
         h.data ->> 'from',
         coalesce(case when (h.data ->> 'to') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then h.data ->> 'to' end, h.data ->> 'from'),
         left(coalesce(nullif(btrim(h.data ->> 'title'), ''), 'Holiday'), 80),
         case when h.data ->> 'type' = 'Event' then 'Event' else 'Holiday' end
  from public.holidays h
  where (select app.my_role()) in ('parent', 'admin', 'teacher')
    and not h.deleted
    and (h.data ->> 'from') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and coalesce(case when (h.data ->> 'to') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then h.data ->> 'to' end, h.data ->> 'from')
        >= to_char((now() at time zone 'Asia/Kolkata')::date - 31, 'YYYY-MM-DD')
  order by 2, 4
  limit 200
$$;
create or replace function public.parent_holidays()
returns table (id text, date_from text, date_to text, title text, kind text)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_holidays()
$$;
revoke all on function app.parent_holidays(), public.parent_holidays() from public, anon;
grant execute on function app.parent_holidays(), public.parent_holidays() to authenticated;

-- ---------- website enquiry rate-limit log (service role only) ----------
create table if not exists public.web_enquiry_hits (
  id bigint generated always as identity primary key,
  ip_hash text not null check (length(ip_hash) between 8 and 128),
  phone text,
  ok boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists web_enquiry_hits_ip_idx on public.web_enquiry_hits (ip_hash, created_at desc);
create index if not exists web_enquiry_hits_created_idx on public.web_enquiry_hits (created_at desc);
revoke all on public.web_enquiry_hits from anon, authenticated;
alter table public.web_enquiry_hits enable row level security;
-- No anon/authenticated grants. An admin-only policy documents intent (the
-- table is used only by the Edge Function with the service role).
drop policy if exists web_enquiry_hits_admin_select on public.web_enquiry_hits;
create policy web_enquiry_hits_admin_select on public.web_enquiry_hits for select to authenticated
  using ((select app.is_admin()));

-- ---------- fee rules (sibling discount + late fee) ----------
-- Valid 10-digit Indian mobiles of a student (parent, guardian, mother, father).
create or replace function app.fee_phones(d jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct n), '{}'::text[]) from (
    select case
             when length(x) = 12 and left(x, 2) = '91' then substr(x, 3)
             when length(x) = 11 and left(x, 1) = '0' then substr(x, 2)
             else x end as n
    from (select regexp_replace(coalesce(d ->> k, ''), '\D', '', 'g') as x
          from unnest(array['phone', 'guardianPhone', 'motherPhone', 'fatherPhone']) k) a
  ) b where n ~ '^[6-9][0-9]{9}$'
$$;

-- Sort key for "older sibling": admission date, then id.
create or replace function app.fee_order_key(p_id text, d jsonb) returns text
language sql immutable set search_path = '' as $$
  select (case when (d ->> 'admissionDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then d ->> 'admissionDate' else '9999-12-31' end) || '|' || p_id
$$;

-- Monthly fee after the (optional) sibling discount: 2nd+ child that shares a
-- parent mobile with an earlier-admitted active child gets the discount.
create or replace function app.fee_net_monthly(p_student text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  st record; sd jsonb; base numeric; mon numeric; yr numeric; v numeric; ph text[]; older boolean;
begin
  select s.id, s.class_id, s.data into st from public.students s where s.id = p_student and not s.deleted;
  if not found then return 0; end if;
  select coalesce((select f.monthly_fee from public.student_fees f where f.student_id = p_student and not f.deleted), 0),
         coalesce((select f.yearly_fee from public.student_fees f where f.student_id = p_student and not f.deleted), 0)
    into mon, yr;
  base := app.effective_monthly(st.class_id, mon, yr);
  select coalesce(x.data, '{}'::jsonb) into sd from public.settings x where x.id = 1 and not x.deleted;
  sd := coalesce(sd, '{}'::jsonb);
  if base <= 0 or sd -> 'siblingOn' is distinct from 'true'::jsonb then return base; end if;
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
  if sd ->> 'siblingType' = 'flat' then
    return greatest(0, round(base - v, 2));
  end if;
  return greatest(0, round(base - base * least(v, 100) / 100.0, 2));
end $$;

-- Late fee for one month: after the due day, until the month's (net) fee was
-- fully paid (by payment date), or until today if still unpaid.
create or replace function app.fee_month_fine(p_student text, p_month text, p_net numeric) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  sd jsonb; amt numeric; mx numeric; dd int; due_d date; end_d date; cum numeric := 0; r record; fine numeric; lf text;
begin
  if p_net is null or p_net <= 0 or p_month !~ '^[0-9]{4}-[0-9]{2}$' then return 0; end if;
  select coalesce(x.data, '{}'::jsonb) into sd from public.settings x where x.id = 1 and not x.deleted;
  sd := coalesce(sd, '{}'::jsonb);
  if sd -> 'lateFeeOn' is distinct from 'true'::jsonb then return 0; end if;
  amt := case when (sd ->> 'lateFeeAmount') ~ '^[0-9]+(\.[0-9]+)?$' then (sd ->> 'lateFeeAmount')::numeric else 0 end;
  if amt <= 0 then return 0; end if;
  lf := case when (sd ->> 'lateFeeFrom') ~ '^[0-9]{4}-[0-9]{2}$' then sd ->> 'lateFeeFrom' else null end;
  if lf is not null and p_month < lf then return 0; end if;
  mx := case when (sd ->> 'lateFeeMax') ~ '^[0-9]+(\.[0-9]+)?$' then (sd ->> 'lateFeeMax')::numeric else 0 end;
  dd := case when (sd ->> 'feeDueDay') ~ '^[0-9]{1,2}$' then least(28, greatest(1, (sd ->> 'feeDueDay')::int)) else 10 end;
  due_d := to_date(p_month || '-' || lpad(dd::text, 2, '0'), 'YYYY-MM-DD');
  end_d := null;
  for r in
    select case when (p.data ->> 'paidOn') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (p.data ->> 'paidOn')::date else null end as paid_on,
           case
             when jsonb_typeof(p.data -> 'alloc') = 'object' then
               case when (p.data -> 'alloc' ->> p_month) ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.data -> 'alloc' ->> p_month)::numeric else 0 end
             when p.data ->> 'month' = p_month and (p.data ->> 'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.data ->> 'amount')::numeric
             else 0 end as amt
    from public.payments p
    where not p.deleted and p.data ->> 'studentId' = p_student
    order by 1 nulls last, coalesce(p.data ->> 'createdAt', '')
  loop
    if r.amt > 0 then
      cum := cum + r.amt;
      if cum >= p_net - 0.005 then end_d := r.paid_on; exit; end if;
    end if;
  end loop;
  end_d := coalesce(end_d, (now() at time zone 'Asia/Kolkata')::date);
  if end_d <= due_d then return 0; end if;
  if sd ->> 'lateFeeType' = 'day' then
    fine := amt * (end_d - due_d);
    if mx > 0 then fine := least(fine, mx); end if;
  else
    fine := amt;
  end if;
  return round(fine, 2);
end $$;

revoke all on function app.fee_phones(jsonb), app.fee_order_key(text, jsonb), app.fee_net_monthly(text), app.fee_month_fine(text, text, numeric) from public, anon;
grant execute on function app.fee_phones(jsonb), app.fee_order_key(text, jsonb), app.fee_net_monthly(text), app.fee_month_fine(text, text, numeric) to authenticated;

-- ---------- parent_fees: sibling discount + late fee (two new columns) ----------
drop function if exists public.parent_fees(text);
drop function if exists app.parent_fees(text);
create function app.parent_fees(p_student text)
returns table (
  enabled boolean, student_id text, student_name text, class_id text, parent_name text,
  monthly_fee numeric, fees_from text, as_of_month text, months_billed int, months_paid int,
  total_due numeric, this_month_due numeric, total_paid numeric,
  school_name text, school_address text, school_phone text, school_email text,
  late_fee numeric, discount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  st record; sd jsonb; fee numeric; base numeric; mon numeric; yr numeric; cur text; adm text; fs text; startm text;
  billed int := 0; mpaid int := 0; due numeric := 0; due_now numeric := 0; tpaid numeric := 0; fines numeric := 0;
  m record; st_status text; fine numeric; charge numeric;
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
  base := app.effective_monthly(st.class_id, mon, yr);
  fee := app.fee_net_monthly(p_student);
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
      fine := app.fee_month_fine(p_student, m.ym, fee);
      charge := fee + fine;
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
  monthly_fee := fee; fees_from := startm; as_of_month := cur;
  months_billed := billed; months_paid := mpaid; total_due := round(due, 2); this_month_due := round(due_now, 2); total_paid := tpaid;
  school_name := coalesce(nullif(sd ->> 'schoolName', ''), 'The Little Wings Play School');
  school_address := coalesce(sd ->> 'address', '');
  school_phone := coalesce(sd ->> 'phone', '');
  school_email := coalesce(sd ->> 'email', '');
  late_fee := round(fines, 2);
  discount := greatest(0, round(base - fee, 2));
  return next;
end $$;

create function public.parent_fees(p_student text)
returns table (
  enabled boolean, student_id text, student_name text, class_id text, parent_name text,
  monthly_fee numeric, fees_from text, as_of_month text, months_billed int, months_paid int,
  total_due numeric, this_month_due numeric, total_paid numeric,
  school_name text, school_address text, school_phone text, school_email text,
  late_fee numeric, discount numeric)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_fees(p_student)
$$;
revoke all on function app.parent_fees(text), public.parent_fees(text) from public, anon;
grant execute on function app.parent_fees(text), public.parent_fees(text) to authenticated;
