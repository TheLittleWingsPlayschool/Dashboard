-- =====================================================================
-- The Little Wings: fee receipts for the Parents app (v2.3). Run AFTER
-- schema.sql and parents.sql. Documentation copy of the SQL that was run on
-- the database. Safe to re-run.
--
-- Security model (additions)
--  * RLS is unchanged: parents still get 0 rows from public.payments and
--    public.student_fees (both stay admin-only).
--  * Parents read their own child's fee summary and payments only through two
--    RPCs, the same pattern as parent_attendance():
--       public.parent_fees(student)     -> one summary row
--       public.parent_payments(student) -> the child's receipts
--    They are SECURITY INVOKER wrappers in public that call SECURITY DEFINER
--    helpers in the private schema "app" (not exposed through the Data API).
--  * The helpers return rows only when (a) the caller is a parent login,
--    (b) the child is linked to that login in parent_students and not deleted,
--    and (c) the admin switched on settings.data.showFeesToParents (default
--    OFF). The switch is checked inside the database, so it cannot be bypassed
--    from the browser. When it is off, parent_fees returns a single row with
--    enabled = false and every other column NULL, and parent_payments returns
--    nothing.
--  * Only parent-safe fields are returned: no internal payment notes, no
--    staff/salary data, no other child or class data.
--
-- Payment rows (public.payments.data, written by the admin dashboard):
--   { seq, receiptNo, studentId, studentName, parentName, classId,
--     month: 'YYYY-MM' (first month covered), months: ['YYYY-MM', ...] (v2.3,
--     optional), alloc: { 'YYYY-MM': amount } (v2.3, optional: how the amount
--     is split over the months), amount, mode, ref, paidOn: 'YYYY-MM-DD',
--     note (internal), receivedBy (v2.3), balanceAfter (v2.3), createdAt }
-- Dues are computed exactly like the dashboard: from the later of the
-- admission month and settings.feesStartMonth up to the current month (IST),
-- monthly fee minus what was paid towards each month; students with status
-- 'Left' or no monthly fee owe nothing.
-- =====================================================================

-- Is the "Show fees to parents" switch on? (staff-only settings row)
create or replace function app.parent_fees_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.data -> 'showFeesToParents' = 'true'::jsonb
                   from public.settings s where s.id = 1 and not s.deleted), false)
$$;

-- Is this child linked to the signed-in parent login?
create or replace function app.parent_owns(p_student text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.parent_students ps
    join public.students s on s.id = ps.student_id and not s.deleted
    join public.profiles p on p.id = ps.user_id and p.role = 'parent'
    where ps.user_id = (select auth.uid()) and ps.student_id = p_student)
$$;

-- Amount paid towards each month by one student (non-deleted payments).
create or replace function app.paid_by_month(p_student text)
returns table (month text, amount numeric)
language sql stable security definer set search_path = '' as $$
  with pays as (
    select p.data
    from public.payments p
    where not p.deleted and p.data ->> 'studentId' = p_student
  ), parts as (
    select a.key as month,
           case when a.value ~ '^-?[0-9]+(\.[0-9]+)?$' then a.value::numeric else 0 end as amount
    from pays, jsonb_each_text(case when jsonb_typeof(pays.data -> 'alloc') = 'object' then pays.data -> 'alloc' else '{}'::jsonb end) a
    union all
    select pays.data ->> 'month',
           case when (pays.data ->> 'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (pays.data ->> 'amount')::numeric else 0 end
    from pays
    where jsonb_typeof(pays.data -> 'alloc') is distinct from 'object'
  )
  select parts.month, sum(parts.amount) from parts
  where parts.month ~ '^[0-9]{4}-[0-9]{2}$'
  group by parts.month
$$;

create or replace function app.parent_fees(p_student text)
returns table (
  enabled boolean, student_id text, student_name text, class_id text, parent_name text,
  monthly_fee numeric, fees_from text, as_of_month text, months_billed int, months_paid int,
  total_due numeric, this_month_due numeric, total_paid numeric,
  school_name text, school_address text, school_phone text, school_email text)
language plpgsql stable security definer set search_path = '' as $$
declare
  st record; sd jsonb; fee numeric; cur text; adm text; fs text; startm text;
  billed int := 0; mpaid int := 0; due numeric := 0; due_now numeric := 0; tpaid numeric := 0;
  m record;
begin
  if not app.parent_owns(p_student) then return; end if;
  if not app.parent_fees_enabled() then
    enabled := false; return next; return;
  end if;
  select s.id, s.class_id, s.data into st from public.students s where s.id = p_student and not s.deleted;
  select coalesce(x.data, '{}'::jsonb) into sd from public.settings x where x.id = 1 and not x.deleted;
  sd := coalesce(sd, '{}'::jsonb);
  select coalesce((select f.monthly_fee from public.student_fees f where f.student_id = p_student and not f.deleted), 0) into fee;
  cur := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
  adm := case when (st.data ->> 'admissionDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then left(st.data ->> 'admissionDate', 7) else cur end;
  fs := case when (sd ->> 'feesStartMonth') ~ '^[0-9]{4}-[0-9]{2}$' then sd ->> 'feesStartMonth' else null end;
  startm := case when fs is not null and fs > adm then fs else adm end;
  select coalesce(sum(b.amount), 0) into tpaid from app.paid_by_month(p_student) b;
  if coalesce(st.data ->> 'status', '') <> 'Left' and fee > 0 and startm <= cur then
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
  parent_name := coalesce(st.data ->> 'parentName', '');
  monthly_fee := fee; fees_from := startm; as_of_month := cur;
  months_billed := billed; months_paid := mpaid; total_due := due; this_month_due := due_now; total_paid := tpaid;
  school_name := coalesce(nullif(sd ->> 'schoolName', ''), 'The Little Wings Play School');
  school_address := coalesce(sd ->> 'address', '');
  school_phone := coalesce(sd ->> 'phone', '');
  school_email := coalesce(sd ->> 'email', '');
  return next;
end $$;

drop function if exists public.parent_payments(text);
drop function if exists app.parent_payments(text);
create or replace function app.parent_payments(p_student text)
returns table (
  id text, receipt_no text, paid_on text, amount numeric, months text[], mode text, ref text,
  received_by text, balance_after numeric, monthly_fee numeric, student_name text, class_id text, parent_name text, created_at text)
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
         coalesce(p.data ->> 'createdAt', p.created_at::text)
  from public.payments p
  where app.parent_owns(p_student)
    and app.parent_fees_enabled()
    and not p.deleted
    and p.data ->> 'studentId' = p_student
  order by coalesce(p.data ->> 'paidOn', '') desc,
           case when (p.data ->> 'seq') ~ '^[0-9]{1,9}$' then (p.data ->> 'seq')::int else 0 end desc
  limit 500
$$;

revoke all on function app.parent_fees_enabled(), app.parent_owns(text), app.paid_by_month(text),
  app.parent_fees(text), app.parent_payments(text) from public, anon;
grant execute on function app.parent_fees_enabled(), app.parent_owns(text), app.paid_by_month(text),
  app.parent_fees(text), app.parent_payments(text) to authenticated;

-- ---------- RPCs for the Parents app (SECURITY INVOKER wrappers) ----------
create or replace function public.parent_fees(p_student text)
returns table (
  enabled boolean, student_id text, student_name text, class_id text, parent_name text,
  monthly_fee numeric, fees_from text, as_of_month text, months_billed int, months_paid int,
  total_due numeric, this_month_due numeric, total_paid numeric,
  school_name text, school_address text, school_phone text, school_email text)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_fees(p_student)
$$;
create or replace function public.parent_payments(p_student text)
returns table (
  id text, receipt_no text, paid_on text, amount numeric, months text[], mode text, ref text,
  received_by text, balance_after numeric, monthly_fee numeric, student_name text, class_id text, parent_name text, created_at text)
language sql stable security invoker set search_path = '' as $$
  select * from app.parent_payments(p_student)
$$;
revoke all on function public.parent_fees(text), public.parent_payments(text) from public, anon;
grant execute on function public.parent_fees(text), public.parent_payments(text) to authenticated;
