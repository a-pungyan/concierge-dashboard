-- Run once in the project's Supabase SQL editor to enable admin resident uploads.
create or replace function public.import_residents(residents jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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
    where nullif(trim(unit), '') is null or coalesce(nullif(trim(first_name), ''), nullif(trim(last_name), '')) is null
      or length(unit) > 100 or length(first_name) > 200 or length(last_name) > 200 or length(tenant_category) > 200
  ) then raise exception 'Every resident needs a unit and a name within the supported length.'; end if;
  lock table public.occupant_report in share row exclusive mode;
  delete from public.occupant_report where id is not null;
  insert into public.occupant_report (unit, first_name, last_name, tenant_category)
  select distinct upper(trim(unit)), nullif(trim(first_name), ''), nullif(trim(last_name), ''), nullif(trim(tenant_category), '')
  from jsonb_to_recordset(residents) as r(unit text, first_name text, last_name text, tenant_category text);
  get diagnostics imported = row_count;
  return imported;
end;
$$;
revoke all on function public.import_residents(jsonb) from public, anon;
grant execute on function public.import_residents(jsonb) to authenticated;
