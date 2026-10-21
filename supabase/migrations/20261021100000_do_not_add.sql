-- Companies that asked to be erased (UK GDPR, right to be forgotten) and must never be added again
-- (Craig, 21 October 2026: NewOrbit). One row per company, the minimum needed to honour the request:
-- the company name, its web address and its Companies House number. No personal data is kept here.
-- A before-insert trigger on company_searches refuses the company; one on prospects quietly skips it,
-- so the nightly discovery carries on with the others.

create table if not exists public.do_not_add (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  name_key text not null,
  domain text,
  company_number text,
  reason text not null,
  requested_at timestamptz not null default now()
);
alter table public.do_not_add enable row level security;
revoke all on table public.do_not_add from anon, authenticated;

-- "NEWORBIT LIMITED" and "NewOrbit" are the same company.
create or replace function public.erasure_name_key(n text)
returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(n, '')), '\m(limited|ltd|plc|llp|inc|llc)\M', '', 'g'), '[^a-z0-9]', '', 'g')
$$;

create or replace function public.erasure_host(u text)
returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(lower(coalesce(u, '')), '^[a-z]+://', ''), '^www\.|/.*$', '', 'g'), '')
$$;

create or replace function public.is_do_not_add(p_name text, p_url text, p_number text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.do_not_add d
    where (public.erasure_name_key(p_name) <> '' and d.name_key = public.erasure_name_key(p_name))
       or (d.domain is not null and public.erasure_host(p_url) is not null and (public.erasure_host(p_url) = d.domain or public.erasure_host(p_url) like '%.' || d.domain))
       or (d.company_number is not null and p_number is not null and d.company_number = p_number)
  )
$$;

create or replace function public.block_do_not_add_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_do_not_add(new.company_name, new.url, new.company_number) then
    raise exception 'This company asked to be removed (UK GDPR) and cannot be added again.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.skip_do_not_add_prospect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_do_not_add(new.name, new.website, new.company_number) then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists company_searches_block_do_not_add on public.company_searches;
create trigger company_searches_block_do_not_add
  before insert or update of company_name, url, company_number on public.company_searches
  for each row execute function public.block_do_not_add_company();

drop trigger if exists prospects_skip_do_not_add on public.prospects;
create trigger prospects_skip_do_not_add
  before insert on public.prospects
  for each row execute function public.skip_do_not_add_prospect();
