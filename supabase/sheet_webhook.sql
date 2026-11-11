-- =====================================================================
-- Little Wings — near-instant Google Sheet sync after each save (v2.9)
-- =====================================================================
-- After a save in the dashboard, a statement-level trigger asks pg_net to
-- POST {"secret": ..., "table": ..., "op": ...} to the Google Apps Script
-- web app (doPost in LittleWings-Sheet-Sync.gs), which then re-syncs the
-- sheet.  The 5-minute Apps Script trigger stays as a safety net.
--
--  * pg_net is available on the Supabase free plan (async HTTP, the call is
--    queued and sent after the save commits, so saves are never slowed).
--  * URL + secret live in app.sheet_webhook_cfg (schema app is not exposed
--    by the API, RLS on, no grants).  NEVER commit the real secret.
--  * Triggers are FOR EACH STATEMENT (a bulk change fires once), SECURITY
--    DEFINER with search_path '', and every error is swallowed so a webhook
--    problem can never block or roll back a save.
--  * Attendance is debounced in the DB: at most one call per 10 s.
--  * Not attached to audit / log tables (audit_log, web_enquiry_hits, ...).
--
-- PART 1 (safe to run any time, does nothing until PART 2): functions + tables.
-- PART 2 (run once the owner sends the web-app URL): config + triggers.
-- PART 3: disable / uninstall.
-- =====================================================================

-- ------------------------------ PART 1 ------------------------------
create extension if not exists pg_net with schema extensions;   -- functions live in schema net

create table if not exists app.sheet_webhook_cfg (
  id int primary key default 1 check (id = 1),
  url text not null check (url ~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$'),
  secret text not null check (length(secret) >= 32),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table app.sheet_webhook_cfg enable row level security;
revoke all on app.sheet_webhook_cfg from public, anon, authenticated;

create table if not exists app.sheet_webhook_state (
  tbl text primary key,
  last_sent timestamptz not null default now()
);
alter table app.sheet_webhook_state enable row level security;
revoke all on app.sheet_webhook_state from public, anon, authenticated;

-- TG_ARGV[0] = debounce seconds for that table (0 = every statement)
create or replace function app.sheet_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record; deb int; hit int;
begin
  begin
    select x.url, x.secret, x.enabled into c from app.sheet_webhook_cfg x where x.id = 1;
    if not found or not c.enabled then return null; end if;
    deb := case when tg_nargs > 0 and tg_argv[0] ~ '^[0-9]{1,4}$' then tg_argv[0]::int else 0 end;
    if deb > 0 then
      hit := null;
      insert into app.sheet_webhook_state as s (tbl, last_sent) values (tg_table_name, now())
        on conflict (tbl) do update set last_sent = now()
        where s.last_sent < now() - make_interval(secs => deb)
        returning 1 into hit;
      if hit is null then return null; end if;             -- called less than deb seconds ago
    end if;
    perform net.http_post(
      url := c.url,
      body := jsonb_build_object('secret', c.secret, 'table', tg_table_name, 'op', tg_op, 'at', now()),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 8000);
  exception when others then
    null;                                                  -- never block or roll back a save
  end;
  return null;
end $$;
revoke all on function app.sheet_notify() from public, anon, authenticated;

-- ------------------------------ PART 2 ------------------------------
-- Replace the two placeholders (the real values are filled in by
-- enable-sheet-webhook.sh — never commit them), then run:
--
-- insert into app.sheet_webhook_cfg (id, url, secret, enabled)
--   values (1, '<WEB_APP_URL>', '<WEBHOOK_SECRET>', true)
--   on conflict (id) do update set url = excluded.url, secret = excluded.secret, enabled = true, updated_at = now();
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['students','student_fees','enquiries','payments','expenses','salaries','staff','holidays'] loop
--     execute format('drop trigger if exists zz_sheet_sync on public.%I', t);
--     execute format('create trigger zz_sheet_sync after insert or update or delete on public.%I for each statement execute function app.sheet_notify(%L)', t, '0');
--   end loop;
--   execute 'drop trigger if exists zz_sheet_sync on public.attendance';
--   execute 'create trigger zz_sheet_sync after insert or update or delete on public.attendance for each statement execute function app.sheet_notify(''10'')';
-- end $$;

-- ------------------------------ PART 3 ------------------------------
-- Pause (keeps everything, stops calls at once):
--   update app.sheet_webhook_cfg set enabled = false, updated_at = now();
-- Resume:
--   update app.sheet_webhook_cfg set enabled = true, updated_at = now();
-- Uninstall completely:
--   do $$ declare t text; begin
--     foreach t in array array['students','student_fees','enquiries','payments','expenses','salaries','staff','holidays','attendance'] loop
--       execute format('drop trigger if exists zz_sheet_sync on public.%I', t);
--     end loop; end $$;
--   drop function if exists app.sheet_notify();
--   drop table if exists app.sheet_webhook_cfg, app.sheet_webhook_state;
--   -- (optional) drop extension pg_net;   -- only if nothing else uses it
