-- CONCIERGE DASHBOARD: NEW PROPERTY SETUP
-- Run this entire file ONCE in your FRIEND'S NEW Supabase project > SQL Editor.
-- It creates empty tables only. No residents, logs, accounts, or credentials are copied.
-- Data API: on. Automatic exposure: may be off (explicit grants are included below).
-- After running: create her user in Authentication > Users, then run grant-admin.sql.
-- Every authenticated user in THIS project can read this property's shared data.
-- Keep public sign-ups disabled for this invite-only dashboard.
-- Claude's quick-log-ai Edge Function is deployed separately; SQL does not deploy it.
-- Permission model: https://supabase.com/docs/guides/database/postgres/row-level-security

begin;

-- Refuse to run over an existing dashboard. A failed run rolls back as one transaction.
do $$
begin
  if to_regclass('public.shift_logs') is not null
     or to_regclass('public.followups') is not null
     or to_regclass('public.notices') is not null
     or to_regclass('public.resources') is not null
     or to_regclass('public.occupant_report') is not null
     or to_regclass('public.app_admins') is not null then
    raise exception 'Dashboard tables already exist. Use this setup only in the new, empty property project.';
  end if;
end;
$$;

create table public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.shift_logs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  shift text not null check (shift in ('Morning', 'Afternoon')),
  section text not null,
  subtype text not null,
  unit text,
  category text,
  description text,
  action_taken text,
  pending_action text,
  guest_suite text,
  check_in date,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  unit text,
  category text not null default 'General',
  owner text not null default 'Concierge',
  assignee text,
  due_date date not null,
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High')),
  status text not null default 'Open' check (status in ('Open', 'In progress', 'Waiting', 'Done')),
  next_action text,
  resolution text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  text text not null check (length(trim(text)) > 0),
  date date not null default current_date,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  name text not null check (length(trim(name)) > 0),
  url text not null,
  notes text,
  tags text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.occupant_report (
  id bigint generated always as identity primary key,
  unit text not null check (length(trim(unit)) between 1 and 100),
  first_name text,
  last_name text,
  tenant_category text,
  created_at timestamptz not null default now(),
  check (coalesce(nullif(trim(first_name), ''), nullif(trim(last_name), '')) is not null),
  check (length(first_name) <= 200 and length(last_name) <= 200 and length(tenant_category) <= 200)
);

-- One person per unit, ignoring case and repeated whitespace in names.
create unique index occupant_report_person_key on public.occupant_report (
  upper(regexp_replace(unit, '\s+', '', 'g')),
  lower(regexp_replace(trim(coalesce(first_name, '')), '\s+', ' ', 'g')),
  lower(regexp_replace(trim(coalesce(last_name, '')), '\s+', ' ', 'g'))
);
create index shift_logs_date_idx on public.shift_logs(date);
create index shift_logs_author_idx on public.shift_logs(created_by);
create index followups_due_idx on public.followups(due_date);
create index followups_author_idx on public.followups(created_by);

-- Set authors on the server, and preserve authorship when an entry is edited.
create function public.dashboard_stamp_record()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_email := auth.jwt() ->> 'email';
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_by_email := old.created_by_email;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.dashboard_stamp_record() from public, anon, authenticated;

create trigger stamp_shift_logs before insert or update on public.shift_logs
for each row execute function public.dashboard_stamp_record();
create trigger stamp_followups before insert or update on public.followups
for each row execute function public.dashboard_stamp_record();
create trigger stamp_notices before insert or update on public.notices
for each row execute function public.dashboard_stamp_record();
create trigger stamp_resources before insert or update on public.resources
for each row execute function public.dashboard_stamp_record();

alter table public.app_admins enable row level security;
alter table public.shift_logs enable row level security;
alter table public.followups enable row level security;
alter table public.notices enable row level security;
alter table public.resources enable row level security;
alter table public.occupant_report enable row level security;

-- No browser user can add themselves to app_admins. Enroll admins in SQL Editor only.
create policy admins_read_own on public.app_admins for select to authenticated
using (user_id = (select auth.uid()));

create policy logs_read on public.shift_logs for select to authenticated using (true);
create policy logs_insert on public.shift_logs for insert to authenticated
with check (created_by = (select auth.uid()));
create policy logs_update on public.shift_logs for update to authenticated
using (created_by = (select auth.uid()) or exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (created_by = (select auth.uid()) or exists (select 1 from public.app_admins where user_id = (select auth.uid())));
create policy logs_delete on public.shift_logs for delete to authenticated
using (created_by = (select auth.uid()) or exists (select 1 from public.app_admins where user_id = (select auth.uid())));

create policy followups_read on public.followups for select to authenticated using (true);
create policy followups_insert on public.followups for insert to authenticated
with check (created_by = (select auth.uid()));
create policy followups_update on public.followups for update to authenticated using (true) with check (true);
create policy followups_delete on public.followups for delete to authenticated
using (created_by = (select auth.uid()) or exists (select 1 from public.app_admins where user_id = (select auth.uid())));

create policy notices_read on public.notices for select to authenticated using (true);
create policy notices_insert on public.notices for insert to authenticated
with check (created_by = (select auth.uid()));
create policy notices_delete on public.notices for delete to authenticated using (true);

create policy resources_read on public.resources for select to authenticated using (true);
create policy resources_insert on public.resources for insert to authenticated
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));
create policy resources_update on public.resources for update to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));
create policy resources_delete on public.resources for delete to authenticated
using (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

create policy occupants_read on public.occupant_report for select to authenticated using (true);
-- Resident writes are only allowed through the admin-checked transactional import RPC.

-- Explicit privileges work with "Automatically expose new tables" switched off.
grant usage on schema public to authenticated, service_role;
revoke all on public.app_admins, public.shift_logs, public.followups,
  public.notices, public.resources, public.occupant_report from public, anon, authenticated;
grant select on public.app_admins, public.occupant_report to authenticated;
grant select, insert, update, delete on public.shift_logs, public.followups, public.resources to authenticated;
grant select, insert, delete on public.notices to authenticated;
grant all on public.app_admins, public.shift_logs, public.followups,
  public.notices, public.resources, public.occupant_report to service_role;
revoke all on sequence public.occupant_report_id_seq from public, anon, authenticated;
grant usage, select on sequence public.occupant_report_id_seq to service_role;

-- Import all selected reports together. Failure rolls back the entire replacement.
create function public.import_residents(residents jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare imported integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.app_admins where user_id = auth.uid()
  ) then
    raise exception 'Only dashboard admins can import residents.' using errcode = '42501';
  end if;
  if jsonb_typeof(residents) is distinct from 'array' then
    raise exception 'Expected a resident list.';
  end if;
  if jsonb_array_length(residents) < 1 or jsonb_array_length(residents) > 20000 then
    raise exception 'Import must contain between 1 and 20,000 residents.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(residents) as r(unit text, first_name text, last_name text, tenant_category text)
    where nullif(trim(unit), '') is null
      or coalesce(nullif(trim(first_name), ''), nullif(trim(last_name), '')) is null
      or length(unit) > 100 or length(first_name) > 200 or length(last_name) > 200 or length(tenant_category) > 200
  ) then raise exception 'Every resident needs a unit and a name within the supported length.'; end if;
  lock table public.occupant_report in share row exclusive mode;
  delete from public.occupant_report where id is not null;
  -- Normalize before deduplicating. Relationship does not create a second person.
  insert into public.occupant_report (unit, first_name, last_name, tenant_category)
  select unit, first_name, last_name, tenant_category
  from (
    select distinct on (unit, lower(coalesce(first_name, '')), lower(coalesce(last_name, '')))
      unit, first_name, last_name, tenant_category
    from (
      select upper(regexp_replace(trim(unit), '\s+', '', 'g')) as unit,
        nullif(regexp_replace(trim(first_name), '\s+', ' ', 'g'), '') as first_name,
        nullif(regexp_replace(trim(last_name), '\s+', ' ', 'g'), '') as last_name,
        nullif(trim(tenant_category), '') as tenant_category,
        position
      from jsonb_array_elements(residents) with ordinality as source(record, position)
      cross join lateral jsonb_to_record(record) as r(unit text, first_name text, last_name text, tenant_category text)
    ) cleaned
    order by unit, lower(coalesce(first_name, '')), lower(coalesce(last_name, '')), position
  ) deduplicated;
  get diagnostics imported = row_count;
  return imported;
end;
$$;
revoke all on function public.import_residents(jsonb) from public, anon, authenticated;
grant execute on function public.import_residents(jsonb) to authenticated;

commit;

select 'Setup complete. Create her Auth user, then run grant-admin.sql with her user ID.' as next_step;
