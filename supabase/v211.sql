-- =====================================================================
-- Little Wings v2.11 — enrollment numbers, committed fee, staff summary
-- =====================================================================
-- Additive and safe to re-run. Never deletes data.
--  1. students.enroll_no  : LW0001, LW0002 … one school-wide sequence,
--     given by the database on insert (trigger), unique, cannot be edited.
--     Existing students are numbered in admission order.
--  2. student_fees.fee_type ('yearly' | 'monthly'), fee_months (1–24) and
--     committed_fee (GENERATED: monthly → per month × months, yearly →
--     yearly fee). Existing monthly-only students become fee_type monthly.
--  3. app.fee_base_month: a monthly payer is not billed after the committed
--     months (only when fee_months is set).
--  4. app.commit_info(): commitment / paid in the period / late fees / balance
--     (same rules as the dashboard), used by the Sheet export and the
--     Parents app (public.parent_commitment).
--  5. app.staff_month_summary(): per staff per month worked days, casual
--     leave, paid leave, holidays (Sundays + holidays), absent, not marked.
--  6. app.sheet_export_data(): adds enrollment no., fee type, committed fee,
--     paid, balance and a staff_monthly list.
-- =====================================================================

-- ---------- 1. enrollment numbers ----------
create sequence if not exists app.enroll_seq as integer minvalue 1 start 1;
revoke all on sequence app.enroll_seq from public, anon, authenticated;

alter table public.students add column if not exists enroll_no text;
create unique index if not exists students_enroll_no_key on public.students (enroll_no);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'students_enroll_no_fmt') then
    alter table public.students add constraint students_enroll_no_fmt check (enroll_no is null or enroll_no ~ '^LW[0-9]{4,9}$');
  end if;
end $$;

create or replace function app.next_enroll_no() returns text
language sql volatile security definer set search_path = '' as $$
  select 'LW' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end
  from (select nextval('app.enroll_seq')::bigint as n) x
$$;
revoke all on function app.next_enroll_no() from public, anon, authenticated;

-- Back-fill: students without a number, in admission order (then entry order).
do $$
declare mx int; r record;
begin
  select coalesce(max(substring(enroll_no from 3)::int), 0) into mx from public.students where enroll_no ~ '^LW[0-9]+$';
  if mx > 0 then perform setval('app.enroll_seq', mx, true); end if;
  for r in
    select id from public.students
     where enroll_no is null and not deleted
     order by case when (data ->> 'admissionDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then data ->> 'admissionDate' end nulls last, created_at, id
  loop
    update public.students set enroll_no = app.next_enroll_no() where id = r.id;
  end loop;
end $$;

create or replace function app.students_enroll() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cur text;
begin
  if tg_op = 'UPDATE' then
    new.enroll_no := old.enroll_no;                         -- never editable
    if new.enroll_no is null and not coalesce(new.deleted, false) then new.enroll_no := app.next_enroll_no(); end if;
    return new;
  end if;
  -- INSERT (also the first step of an upsert): keep an existing row's number,
  -- so saving an existing student never uses up a number.
  select s.enroll_no into cur from public.students s where s.id = new.id;
  if found then new.enroll_no := cur; return new; end if;
  new.enroll_no := case when coalesce(new.deleted, false) then null else app.next_enroll_no() end;
  return new;
end $$;
revoke all on function app.students_enroll() from public, anon, authenticated;
drop trigger if exists enroll_students on public.students;
create trigger enroll_students before insert or update on public.students
  for each row execute function app.students_enroll();

-- ---------- 2. fee type, months, committed fee ----------
alter table public.student_fees add column if not exists fee_type text not null default 'yearly';
alter table public.student_fees add column if not exists fee_months smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'student_fees_fee_type_chk') then
    alter table public.student_fees add constraint student_fees_fee_type_chk check (fee_type in ('yearly', 'monthly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'student_fees_fee_months_chk') then
    alter table public.student_fees add constraint student_fees_fee_months_chk check (fee_months is null or fee_months between 1 and 24);
  end if;
end $$;
alter table public.student_fees add column if not exists committed_fee numeric
  generated always as (case when fee_type = 'monthly'
                            then case when fee_months is not null then round(coalesce(monthly_fee, 0) * fee_months, 2) end
                            else round(coalesce(yearly_fee, 0), 2) end) stored;
-- Back-fill: students who only have a monthly fee are monthly payers (months left blank: the school fills them in).
update public.student_fees set fee_type = 'monthly'
 where coalesce(monthly_fee, 0) > 0 and coalesce(yearly_fee, 0) = 0 and fee_type <> 'monthly';

-- ---------- 3. commitment period helpers ----------
-- First month of the current commitment: admission month / "fees from" month,
-- or the month after the last fee-history period (year-end promotion).
create or replace function app.commit_from(p_student text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare st record; sd jsonb; adm text; fs text; startm text; lastu text; cur text;
begin
  cur := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
  select s.data into st from public.students s where s.id = p_student and not s.deleted;
  if not found then return null; end if;
  select coalesce(x.data, '{}'::jsonb) into sd from public.settings x where x.id = 1 and not x.deleted;
  sd := coalesce(sd, '{}'::jsonb);
  adm := case when (st.data ->> 'admissionDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then left(st.data ->> 'admissionDate', 7) else cur end;
  fs := case when (sd ->> 'feesStartMonth') ~ '^[0-9]{4}-[0-9]{2}$' then sd ->> 'feesStartMonth' else null end;
  startm := case when fs is not null and fs > adm then fs else adm end;
  select max(e ->> 'until') into lastu from public.student_fees f, jsonb_array_elements(coalesce(f.fee_hist, '[]'::jsonb)) e
   where f.student_id = p_student and not f.deleted and (e ->> 'until') ~ '^[0-9]{4}-[0-9]{2}$';
  if lastu is not null then
    lastu := to_char(to_date(lastu || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
    if lastu > startm then startm := lastu; end if;
  end if;
  return startm;
end $$;
revoke all on function app.commit_from(text) from public, anon, authenticated;

create or replace function app.fee_base_month(p_student text, p_month text) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare st record; f record; h jsonb; cf text;
begin
  select s.id, s.class_id into st from public.students s where s.id = p_student and not s.deleted;
  if not found then return 0; end if;
  select coalesce(x.monthly_fee, 0) as monthly_fee, coalesce(x.yearly_fee, 0) as yearly_fee, coalesce(x.fee_hist, '[]'::jsonb) as fee_hist,
         x.fee_type, x.fee_months
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
    -- v2.11: a monthly payer is billed only for the committed months.
    if f.fee_type = 'monthly' and f.fee_months is not null then
      cf := app.commit_from(p_student);
      if cf is not null and p_month > to_char(to_date(cf || '-01', 'YYYY-MM-DD') + make_interval(months => f.fee_months - 1), 'YYYY-MM') then
        return 0;
      end if;
    end if;
  end if;
  return app.effective_monthly(st.class_id, f.monthly_fee, f.yearly_fee);
end $$;

-- ---------- 4. commitment / paid / balance ----------
create or replace function app.commit_info(p_student text)
returns table (enroll_no text, fee_type text, fee_months int, committed_fee numeric, commit_from text, commit_to text,
               discount numeric, van_fee numeric, commitment numeric, paid numeric, late_fee numeric, balance numeric)
language plpgsql stable security definer set search_path = '' as $$
declare f record; cf text; n int; cur text; m record; tu numeric; vn numeric; disc numeric := 0; van numeric := 0; fines numeric := 0; pd numeric := 0;
begin
  select s.enroll_no as eno, coalesce(x.fee_type, 'yearly') as ft, x.fee_months as fm, x.committed_fee as cfee
    into f from public.students s left join public.student_fees x on x.student_id = s.id and not x.deleted
   where s.id = p_student and not s.deleted;
  if not found then return; end if;
  enroll_no := f.eno; fee_type := f.ft; fee_months := f.fm; committed_fee := f.cfee;
  cf := app.commit_from(p_student);
  n := case when f.ft = 'monthly' then f.fm else 12 end;
  if f.cfee is null or cf is null or n is null then return next; return; end if;
  cur := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
  commit_from := cf;
  commit_to := to_char(to_date(cf || '-01', 'YYYY-MM-DD') + make_interval(months => n - 1), 'YYYY-MM');
  for m in
    select to_char(g, 'YYYY-MM') as ym, coalesce(pb.amount, 0) as paid
      from generate_series(to_date(cf || '-01', 'YYYY-MM-DD'), to_date(commit_to || '-01', 'YYYY-MM-DD'), interval '1 month') g
      left join app.paid_by_month(p_student) pb on pb.month = to_char(g, 'YYYY-MM')
  loop
    pd := pd + m.paid;
    tu := app.fee_net_month(p_student, m.ym);
    if tu <= 0 then continue; end if;
    disc := disc + greatest(0, app.fee_base_month(p_student, m.ym) - tu);
    vn := app.fee_van_month(p_student, m.ym);
    van := van + vn;
    if m.ym <= cur then fines := fines + app.fee_month_fine(p_student, m.ym, tu + vn); end if;
  end loop;
  discount := round(disc, 2); van_fee := round(van, 2); late_fee := round(fines, 2); paid := round(pd, 2);
  commitment := round(f.cfee - disc + van, 2);
  balance := round(commitment + fines - pd, 2);
  return next;
end $$;
revoke all on function app.commit_info(text) from public, anon, authenticated;

-- Parents app: the child's commitment (same checks as parent_fees).
create or replace function app.parent_commitment(p_student text)
returns table (enroll_no text, fee_type text, fee_months int, commitment numeric, paid numeric, balance numeric, commit_from text, commit_to text)
language sql stable security definer set search_path = '' as $$
  select c.enroll_no, c.fee_type, c.fee_months, c.commitment, c.paid, c.balance, c.commit_from, c.commit_to
    from app.commit_info(p_student) c
   where app.parent_owns(p_student) and app.parent_fees_enabled()
$$;
revoke all on function app.parent_commitment(text) from public, anon;
grant execute on function app.parent_commitment(text) to authenticated;
-- Per-receipt snapshot (commitment / paid till date / balance at the time of payment).
create or replace function app.parent_payment_snaps(p_student text)
returns table (id text, commitment numeric, paid_to_date numeric, commit_balance numeric, enroll_no text)
language sql stable security definer set search_path = '' as $$
  select p.id,
         case when (p.data ->> 'commitment') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.data ->> 'commitment')::numeric end,
         case when (p.data ->> 'paidToDate') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.data ->> 'paidToDate')::numeric end,
         case when (p.data ->> 'commitBalance') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.data ->> 'commitBalance')::numeric end,
         left(coalesce(p.data ->> 'enrollNo', ''), 12)
    from public.payments p
   where app.parent_owns(p_student) and app.parent_fees_enabled() and not p.deleted and p.data ->> 'studentId' = p_student
   limit 500
$$;
revoke all on function app.parent_payment_snaps(text) from public, anon;
grant execute on function app.parent_payment_snaps(text) to authenticated;

create or replace function public.parent_commitment(p_student text)
returns table (enroll_no text, fee_type text, fee_months int, commitment numeric, paid numeric, balance numeric, commit_from text, commit_to text)
language sql stable security invoker set search_path = '' as $$ select * from app.parent_commitment(p_student) $$;
create or replace function public.parent_payment_snaps(p_student text)
returns table (id text, commitment numeric, paid_to_date numeric, commit_balance numeric, enroll_no text)
language sql stable security invoker set search_path = '' as $$ select * from app.parent_payment_snaps(p_student) $$;
revoke all on function public.parent_commitment(text), public.parent_payment_snaps(text) from public, anon;
grant execute on function public.parent_commitment(text), public.parent_payment_snaps(text) to authenticated;

-- ---------- 5. staff monthly summary ----------
-- Sundays and holidays (type <> Event) are Holidays; marks saved on them are ignored.
-- Worked = Present + ½ Half-day; Absent = Absent + ½ Half-day.
create or replace function app.staff_month_summary(p_from text, p_to text)
returns table (month text, staff_id text, staff text, role text, days int, holidays int, school_days int,
               worked numeric, casual_leave int, paid_leave int, absent numeric, not_marked int)
language sql stable security definer set search_path = '' as $$
  with months as (
    select to_char(g, 'YYYY-MM') ym, g::date d0,
           least((g + interval '1 month - 1 day')::date, (now() at time zone 'Asia/Kolkata')::date) d1
      from generate_series(to_date(p_from || '-01', 'YYYY-MM-DD'), to_date(p_to || '-01', 'YYYY-MM-DD'), interval '1 month') g
     where g::date <= (now() at time zone 'Asia/Kolkata')::date
  ), days as (
    select m.ym, d::date as dd,
           (extract(dow from d) = 0 or exists (
              select 1 from public.holidays h
               where not h.deleted and coalesce(nullif(h.data ->> 'type', ''), 'Holiday') <> 'Event'
                 and (h.data ->> 'from') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 and d::date between (h.data ->> 'from')::date
                     and greatest((h.data ->> 'from')::date, case when (h.data ->> 'to') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (h.data ->> 'to')::date else (h.data ->> 'from')::date end))) as off
      from months m, generate_series(m.d0, m.d1, interval '1 day') d
  ), st as (
    select s.id, s.data ->> 'name' nm, s.data ->> 'role' rl from public.staff s
     where not s.deleted and coalesce(s.data ->> 'status', '') <> 'Left'
  ), marks as (
    select a.id::date as dd, kv.key as sid, kv.value v
      from public.staff_attendance a cross join lateral jsonb_each_text(case when jsonb_typeof(a.data) = 'object' then a.data else '{}'::jsonb end) kv
     where not a.deleted and a.id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  )
  select d.ym, st.id, st.nm, st.rl,
         count(*)::int,
         count(*) filter (where d.off)::int,
         count(*) filter (where not d.off)::int,
         (count(*) filter (where not d.off and mk.v = 'P') + 0.5 * count(*) filter (where not d.off and mk.v = 'H'))::numeric,
         count(*) filter (where not d.off and mk.v = 'C')::int,
         count(*) filter (where not d.off and mk.v = 'L')::int,
         (count(*) filter (where not d.off and mk.v = 'A') + 0.5 * count(*) filter (where not d.off and mk.v = 'H'))::numeric,
         count(*) filter (where not d.off and (mk.v is null or mk.v not in ('P', 'H', 'C', 'L', 'A')))::int
    from days d cross join st
    left join marks mk on mk.dd = d.dd and mk.sid = st.id
   group by d.ym, st.id, st.nm, st.rl
   order by d.ym desc, lower(st.nm)
$$;
revoke all on function app.staff_month_summary(text, text) from public, anon, authenticated;

-- ---------- 6. Google Sheet export ----------
create or replace function app.sheet_export_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cur text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM'); r jsonb; first_m text;
begin
  select least(cur, coalesce(min(left(a.id, 7)), cur)) into first_m from public.staff_attendance a where not a.deleted and a.id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  first_m := greatest(first_m, to_char((now() at time zone 'Asia/Kolkata')::date - interval '11 months', 'YYYY-MM'));
  select jsonb_build_object(
    'ok', true,
    'generated_at', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'),
    'as_of_month', cur,
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'enroll_no', s.enroll_no, 'name', s.data ->> 'name', 'class', app.sheet_class_name(s.class_id), 'section', s.data ->> 'section',
        'status', coalesce(nullif(s.data ->> 'status', ''), 'Active'), 'admission_date', s.data ->> 'admissionDate', 'dob', s.data ->> 'dob',
        'father_name', s.data ->> 'fatherName', 'father_phone', s.data ->> 'fatherPhone', 'mother_name', s.data ->> 'motherName',
        'mother_phone', s.data ->> 'motherPhone', 'guardian_name', s.data ->> 'guardianName', 'guardian_phone', s.data ->> 'guardianPhone',
        'phone', s.data ->> 'phone', 'whatsapp', s.data ->> 'whatsapp', 'emergency', s.data ->> 'emergency', 'pickup', s.data ->> 'pickup',
        'address', s.data ->> 'address',
        'monthly_fee', f.monthly_fee, 'yearly_fee', f.yearly_fee, 'van_fee', f.van_fee,
        'fee_type', coalesce(f.fee_type, 'yearly'), 'fee_months', f.fee_months, 'committed_fee', f.committed_fee)
        order by s.class_id, lower(s.data ->> 'name'))
      from public.students s left join public.student_fees f on f.student_id = s.id and not f.deleted
      where not s.deleted), '[]'::jsonb),
    'enquiries', coalesce((select jsonb_agg(jsonb_build_object(
        'date', e.data ->> 'date', 'child_name', coalesce(e.data ->> 'childName', e.data ->> 'name'), 'dob', e.data ->> 'dob',
        'class', app.sheet_class_name(coalesce(e.data ->> 'classWanted', e.data ->> 'classId', e.data ->> 'class')),
        'father_name', e.data ->> 'fatherName', 'father_phone', e.data ->> 'fatherPhone', 'mother_name', e.data ->> 'motherName',
        'mother_phone', e.data ->> 'motherPhone', 'parent_name', e.data ->> 'parentName', 'phone', e.data ->> 'phone',
        'source', e.data ->> 'source', 'feedback', e.data ->> 'feedback', 'status', e.data ->> 'status', 'follow_up', e.data ->> 'followUp',
        'notes', coalesce(e.data ->> 'notes', e.data ->> 'note'))
        order by e.data ->> 'date' desc nulls last)
      from public.enquiries e where not e.deleted), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'paid_on', p.data ->> 'paidOn', 'receipt_no', p.data ->> 'receiptNo', 'student', p.data ->> 'studentName',
        'enroll_no', coalesce(nullif(p.data ->> 'enrollNo', ''), s.enroll_no),
        'class', app.sheet_class_name(p.data ->> 'classId'), 'parent', p.data ->> 'parentName',
        'months', case when jsonb_typeof(p.data -> 'months') = 'array' and jsonb_array_length(p.data -> 'months') > 0
                       then (select string_agg(x, ', ' order by x) from jsonb_array_elements_text(p.data -> 'months') x) else p.data ->> 'month' end,
        'amount', app.sheet_num(p.data ->> 'amount'), 'mode', p.data ->> 'mode', 'ref', p.data ->> 'ref',
        'discount', app.sheet_num(p.data ->> 'discount'), 'late_fee', app.sheet_num(p.data ->> 'lateFee'), 'van_fee', app.sheet_num(p.data ->> 'vanFee'),
        'balance_after', app.sheet_num(p.data ->> 'balanceAfter'),
        'commitment', app.sheet_num(p.data ->> 'commitment'), 'paid_to_date', app.sheet_num(p.data ->> 'paidToDate'), 'commit_balance', app.sheet_num(p.data ->> 'commitBalance'),
        'received_by', p.data ->> 'receivedBy', 'note', p.data ->> 'note')
        order by p.data ->> 'paidOn' desc nulls last, p.data ->> 'receiptNo' desc)
      from public.payments p left join public.students s on s.id = p.data ->> 'studentId' where not p.deleted), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(jsonb_build_object(
        'enroll_no', s.enroll_no, 'student', s.data ->> 'name', 'class', app.sheet_class_name(s.class_id), 'section', s.data ->> 'section',
        'parent', coalesce(nullif(btrim(s.data ->> 'parentName'), ''), nullif(btrim(s.data ->> 'fatherName'), ''), nullif(btrim(s.data ->> 'motherName'), ''), nullif(btrim(s.data ->> 'guardianName'), '')),
        'phone', coalesce(nullif(s.data ->> 'whatsapp', ''), nullif(s.data ->> 'phone', ''), nullif(s.data ->> 'fatherPhone', ''), nullif(s.data ->> 'motherPhone', ''), s.data ->> 'guardianPhone'),
        'month', cur, 'monthly_fee', fr.monthly_fee, 'van_fee', fr.van_fee, 'discount', fr.discount, 'late_fee', fr.late_fee,
        'this_month_due', fr.this_month_due, 'total_due', fr.total_due, 'months_billed', fr.months_billed, 'months_paid', fr.months_paid,
        'total_paid', fr.total_paid, 'fees_from', fr.fees_from,
        'fee_type', ci.fee_type, 'fee_months', ci.fee_months, 'committed_fee', ci.committed_fee, 'commitment', ci.commitment,
        'commit_paid', ci.paid, 'commit_balance', ci.balance, 'commit_from', ci.commit_from, 'commit_to', ci.commit_to)
        order by fr.total_due desc, s.class_id, lower(s.data ->> 'name'))
      from public.students s cross join lateral app.sheet_fee_row(s.id) fr cross join lateral app.commit_info(s.id) ci
      where not s.deleted and coalesce(s.data ->> 'status', '') not in ('Left', 'Inactive')), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object(
        'date', a.day, 'class', app.sheet_class_name(a.class_id), 'student', coalesce(s.data ->> 'name', kv.key), 'status',
        case kv.value when 'P' then 'Present' when 'A' then 'Absent' when 'L' then 'Leave' when 'H' then 'Half day' else kv.value end)
        order by a.day desc, a.class_id, lower(coalesce(s.data ->> 'name', kv.key)))
      from public.attendance a cross join lateral jsonb_each_text(case when jsonb_typeof(a.data) = 'object' then a.data else '{}'::jsonb end) kv
      left join public.students s on s.id = kv.key
      where not a.deleted and a.day >= ((now() at time zone 'Asia/Kolkata')::date - 89) and kv.value in ('P', 'A', 'L', 'H')), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object(
        'date', x.data ->> 'date', 'title', x.data ->> 'title', 'category', x.data ->> 'category', 'amount', app.sheet_num(x.data ->> 'amount'),
        'mode', x.data ->> 'mode', 'note', x.data ->> 'note') order by x.data ->> 'date' desc nulls last)
      from public.expenses x where not x.deleted), '[]'::jsonb),
    'salaries', coalesce((select jsonb_agg(jsonb_build_object(
        'month', x.data ->> 'month', 'staff', x.data ->> 'staffName', 'role', x.data ->> 'role', 'base', app.sheet_num(x.data ->> 'base'),
        'bonus', app.sheet_num(x.data ->> 'bonus'), 'advance', app.sheet_num(x.data ->> 'advance'), 'deduction', app.sheet_num(x.data ->> 'deduction'),
        'amount', app.sheet_num(x.data ->> 'amount'), 'paid_on', x.data ->> 'paidOn', 'mode', x.data ->> 'mode', 'slip_no', x.data ->> 'slipNo',
        'note', x.data ->> 'note') order by x.data ->> 'month' desc, x.data ->> 'staffName')
      from public.salaries x where not x.deleted), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'name', x.data ->> 'name', 'role', x.data ->> 'role', 'class', app.sheet_class_name(x.data ->> 'classId'), 'phone', x.data ->> 'phone',
        'salary', app.sheet_num(x.data ->> 'salary'), 'joined', x.data ->> 'joined', 'status', coalesce(nullif(x.data ->> 'status', ''), 'Active'))
        order by lower(x.data ->> 'name'))
      from public.staff x where not x.deleted), '[]'::jsonb),
    'staff_monthly', coalesce((select jsonb_agg(jsonb_build_object(
        'month', z.month, 'staff', z.staff, 'role', z.role, 'worked', z.worked, 'casual_leave', z.casual_leave, 'paid_leave', z.paid_leave,
        'holidays', z.holidays, 'absent', z.absent, 'not_marked', z.not_marked, 'days', z.days, 'school_days', z.school_days)
        order by z.month desc, z.ord, lower(z.staff))
      from (
        select y.month, y.staff, y.role, y.worked, y.casual_leave, y.paid_leave, y.holidays, y.absent, y.not_marked, y.days, y.school_days, 0 as ord
          from app.staff_month_summary(first_m, cur) y
        union all
        select y.month, 'TOTAL (all staff)', '', sum(y.worked), sum(y.casual_leave)::int, sum(y.paid_leave)::int, sum(y.holidays)::int,
               sum(y.absent), sum(y.not_marked)::int, sum(y.days)::int, sum(y.school_days)::int, 1
          from app.staff_month_summary(first_m, cur) y group by y.month
      ) z), '[]'::jsonb),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object(
        'from', x.data ->> 'from', 'to', coalesce(nullif(x.data ->> 'to', ''), x.data ->> 'from'), 'title', x.data ->> 'title',
        'type', coalesce(nullif(x.data ->> 'type', ''), 'Holiday'), 'note', x.data ->> 'note') order by x.data ->> 'from')
      from public.holidays x where not x.deleted), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function app.sheet_export_data() from public, anon, authenticated;

-- ---------- 7. staff attendance also refreshes the Google Sheet (staff summary) ----------
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'sheet_notify')
     and not exists (select 1 from pg_trigger where tgname = 'zz_sheet_sync' and tgrelid = 'public.staff_attendance'::regclass) then
    create trigger zz_sheet_sync after insert or update or delete on public.staff_attendance
      for each statement execute function app.sheet_notify('10');
  end if;
end $$;
