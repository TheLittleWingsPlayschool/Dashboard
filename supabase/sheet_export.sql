-- =====================================================================
-- Little Wings — read-only export for the Google Sheet mirror (v2.9)
-- =====================================================================
-- public.sheet_export(p_token text) returns ONE json object with the
-- arrays the Google Apps Script ("LittleWings-Sheet-Sync.gs") writes into
-- the "Dashboard" Google Sheet.  It is READ-ONLY for school data.
--
-- Security
--  * The token is never stored: only sha256(salt || token) lives in
--    app.sheet_tokens (schema app is not exposed by the API, RLS on, no
--    grants).  Wrong / revoked token -> {"ok":false,"error":"denied"}
--    (generic, nothing else is returned).
--  * Every call is logged (time + ok flag only) in app.sheet_export_hits.
--    More than 20 failed calls in 10 minutes, or more than 120 calls in
--    10 minutes, -> {"ok":false,"error":"busy"} until it calms down.
--  * Never exported: auth / login emails, tokens, passwords, storage
--    paths, photo / document fields, medical notes, parent logins,
--    audit logs.
--  * Call it with POST (/rest/v1/rpc/sheet_export) — it writes the hit log.
--
-- Rotate / revoke the token (run in the Supabase SQL editor)
--   1. On a computer:  node -e "const c=require('crypto');const t=c.randomBytes(48).toString('base64url');const s=c.randomBytes(16);console.log('TOKEN',t);console.log('SALT',s.toString('hex'));console.log('HASH',c.createHash('sha256').update(Buffer.concat([s,Buffer.from(t)])).digest('hex'))"
--   2. SQL (paste only SALT and HASH, never the token):
--        update app.sheet_tokens set revoked_at = now() where revoked_at is null;
--        insert into app.sheet_tokens (label, salt, hash) values ('sheet-sync', '<SALT>', '<HASH>');
--   3. Put TOKEN into SHEET_TOKEN in the Apps Script and Save.
--   Revoke everything (stops the sheet sync at once):
--        update app.sheet_tokens set revoked_at = now() where revoked_at is null;
--   Remove completely:  drop function if exists public.sheet_export(text);
-- =====================================================================

create schema if not exists app;

create table if not exists app.sheet_tokens (
  id bigint generated always as identity primary key,
  label text not null default 'sheet-sync',
  salt text not null check (salt ~ '^[0-9a-f]{32,}$'),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table app.sheet_tokens enable row level security;
revoke all on app.sheet_tokens from public, anon, authenticated;

create table if not exists app.sheet_export_hits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ok boolean not null
);
create index if not exists sheet_export_hits_at_idx on app.sheet_export_hits (at desc);
alter table app.sheet_export_hits enable row level security;
revoke all on app.sheet_export_hits from public, anon, authenticated;

-- constant-time-ish compare of two hex strings of equal length
create or replace function app.sheet_ct_equal(a text, b text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare d int := 0; i int;
begin
  if a is null or b is null or length(a) <> length(b) then return false; end if;
  for i in 1 .. length(a) loop d := d | (ascii(substr(a, i, 1)) # ascii(substr(b, i, 1))); end loop;
  return d = 0;
end $$;
revoke all on function app.sheet_ct_equal(text, text) from public, anon, authenticated;

create or replace function app.sheet_class_name(c text) returns text
language sql immutable set search_path = '' as $$
  select case lower(coalesce(c, '')) when 'toddlers' then 'Toddlers' when 'toddler' then 'Toddlers' when 'nursery' then 'Nursery'
    when 'lkg' then 'LKG' when 'ukg' then 'UKG' else coalesce(c, '') end
$$;
revoke all on function app.sheet_class_name(text) from public, anon, authenticated;

create or replace function app.sheet_num(v text) returns numeric
language sql immutable set search_path = '' as $$
  select case when v ~ '^-?[0-9]+(\.[0-9]+)?$' then v::numeric else null end
$$;
revoke all on function app.sheet_num(text) from public, anon, authenticated;

-- Same month-by-month logic as app.parent_fees (dashboard numbers), without the parent checks.
create or replace function app.sheet_fee_row(p_student text)
returns table (monthly_fee numeric, van_fee numeric, discount numeric, this_month_due numeric, total_due numeric,
               late_fee numeric, months_billed int, months_paid int, total_paid numeric, fees_from text)
language plpgsql stable security definer set search_path = '' as $$
declare
  st record; sd jsonb; cur text; adm text; fs text; startm text;
  billed int := 0; mpaid int := 0; due numeric := 0; due_now numeric := 0; tpaid numeric := 0; fines numeric := 0;
  m record; fine numeric; charge numeric; tu numeric; vn numeric;
begin
  select s.id, s.class_id, s.data into st from public.students s where s.id = p_student and not s.deleted;
  if not found then return; end if;
  select coalesce(x.data, '{}'::jsonb) into sd from public.settings x where x.id = 1 and not x.deleted;
  sd := coalesce(sd, '{}'::jsonb);
  cur := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
  adm := case when (st.data ->> 'admissionDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then left(st.data ->> 'admissionDate', 7) else cur end;
  fs := case when (sd ->> 'feesStartMonth') ~ '^[0-9]{4}-[0-9]{2}$' then sd ->> 'feesStartMonth' else null end;
  startm := case when fs is not null and fs > adm then fs else adm end;
  select coalesce(sum(b.amount), 0) into tpaid from app.paid_by_month(p_student) b;
  if coalesce(st.data ->> 'status', '') not in ('Left', 'Inactive') and startm <= cur then
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
      fines := fines + fine; billed := billed + 1;
      if m.paid >= charge - 0.005 then mpaid := mpaid + 1; end if;
      due := due + greatest(0, charge - m.paid);
      if m.ym = cur then due_now := greatest(0, charge - m.paid); end if;
    end loop;
  end if;
  monthly_fee := app.fee_net_month(p_student, cur);
  van_fee := app.fee_van_month(p_student, cur);
  discount := greatest(0, round(app.fee_base_month(p_student, cur) - app.fee_net_month(p_student, cur), 2));
  this_month_due := round(due_now, 2); total_due := round(due, 2); late_fee := round(fines, 2);
  months_billed := billed; months_paid := mpaid; total_paid := tpaid; fees_from := startm;
  return next;
end $$;
revoke all on function app.sheet_fee_row(text) from public, anon, authenticated;

create or replace function app.sheet_export_data() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cur text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM'); r jsonb;
begin
  select jsonb_build_object(
    'ok', true,
    'generated_at', to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS'),
    'as_of_month', cur,
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.data ->> 'name', 'class', app.sheet_class_name(s.class_id), 'section', s.data ->> 'section',
        'status', coalesce(nullif(s.data ->> 'status', ''), 'Active'), 'admission_date', s.data ->> 'admissionDate', 'dob', s.data ->> 'dob',
        'father_name', s.data ->> 'fatherName', 'father_phone', s.data ->> 'fatherPhone', 'mother_name', s.data ->> 'motherName',
        'mother_phone', s.data ->> 'motherPhone', 'guardian_name', s.data ->> 'guardianName', 'guardian_phone', s.data ->> 'guardianPhone',
        'phone', s.data ->> 'phone', 'whatsapp', s.data ->> 'whatsapp', 'emergency', s.data ->> 'emergency', 'pickup', s.data ->> 'pickup',
        'address', s.data ->> 'address',
        'monthly_fee', f.monthly_fee, 'yearly_fee', f.yearly_fee, 'van_fee', f.van_fee)
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
        'class', app.sheet_class_name(p.data ->> 'classId'), 'parent', p.data ->> 'parentName',
        'months', case when jsonb_typeof(p.data -> 'months') = 'array' and jsonb_array_length(p.data -> 'months') > 0
                       then (select string_agg(x, ', ' order by x) from jsonb_array_elements_text(p.data -> 'months') x) else p.data ->> 'month' end,
        'amount', app.sheet_num(p.data ->> 'amount'), 'mode', p.data ->> 'mode', 'ref', p.data ->> 'ref',
        'discount', app.sheet_num(p.data ->> 'discount'), 'late_fee', app.sheet_num(p.data ->> 'lateFee'), 'van_fee', app.sheet_num(p.data ->> 'vanFee'),
        'balance_after', app.sheet_num(p.data ->> 'balanceAfter'), 'received_by', p.data ->> 'receivedBy', 'note', p.data ->> 'note')
        order by p.data ->> 'paidOn' desc nulls last, p.data ->> 'receiptNo' desc)
      from public.payments p where not p.deleted), '[]'::jsonb),
    'pending', coalesce((select jsonb_agg(jsonb_build_object(
        'student', s.data ->> 'name', 'class', app.sheet_class_name(s.class_id), 'section', s.data ->> 'section',
        'parent', coalesce(nullif(btrim(s.data ->> 'parentName'), ''), nullif(btrim(s.data ->> 'fatherName'), ''), nullif(btrim(s.data ->> 'motherName'), ''), nullif(btrim(s.data ->> 'guardianName'), '')),
        'phone', coalesce(nullif(s.data ->> 'whatsapp', ''), nullif(s.data ->> 'phone', ''), nullif(s.data ->> 'fatherPhone', ''), nullif(s.data ->> 'motherPhone', ''), s.data ->> 'guardianPhone'),
        'month', cur, 'monthly_fee', fr.monthly_fee, 'van_fee', fr.van_fee, 'discount', fr.discount, 'late_fee', fr.late_fee,
        'this_month_due', fr.this_month_due, 'total_due', fr.total_due, 'months_billed', fr.months_billed, 'months_paid', fr.months_paid,
        'total_paid', fr.total_paid, 'fees_from', fr.fees_from)
        order by fr.total_due desc, s.class_id, lower(s.data ->> 'name'))
      from public.students s cross join lateral app.sheet_fee_row(s.id) fr
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
    'holidays', coalesce((select jsonb_agg(jsonb_build_object(
        'from', x.data ->> 'from', 'to', coalesce(nullif(x.data ->> 'to', ''), x.data ->> 'from'), 'title', x.data ->> 'title',
        'type', coalesce(nullif(x.data ->> 'type', ''), 'Holiday'), 'note', x.data ->> 'note') order by x.data ->> 'from')
      from public.holidays x where not x.deleted), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function app.sheet_export_data() from public, anon, authenticated;

create or replace function public.sheet_export(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare fails int; total int; good boolean := false; t record;
begin
  delete from app.sheet_export_hits where at < now() - interval '2 days';
  select count(*) filter (where not ok), count(*) into fails, total from app.sheet_export_hits where at > now() - interval '10 minutes';
  if fails >= 20 or total >= 120 then
    insert into app.sheet_export_hits (ok) values (false);
    return jsonb_build_object('ok', false, 'error', 'busy');
  end if;
  if p_token is not null and length(p_token) between 32 and 200 then
    for t in select salt, hash from app.sheet_tokens where revoked_at is null loop
      if app.sheet_ct_equal(encode(sha256(decode(t.salt, 'hex') || convert_to(p_token, 'UTF8')), 'hex'), t.hash) then good := true; end if;
    end loop;
  end if;
  insert into app.sheet_export_hits (ok) values (good);
  if not good then return jsonb_build_object('ok', false, 'error', 'denied'); end if;
  return app.sheet_export_data();
end $$;
revoke all on function public.sheet_export(text) from public;
grant execute on function public.sheet_export(text) to anon, authenticated;
