-- Funding news (slice 2, 21 September 2026): one row per raise story read
-- from UKTN, Sifted and Google News RSS by sync-funding-news (05:20 UTC,
-- 20260921120100_cron_jobs.sql), keyed by the canonical article URL so a
-- story seen in two feeds is one row. A story whose company name matches a
-- tracked company carries matched_company_search_id and joins that
-- company's facts as a funding_round (loadFundingNewsFacts in
-- _shared/signals/load.ts); the rest are "New raises this week" on My
-- patch, with one-click add. Read by app users, written by the service role.
--
-- Applied by scripts/local-db-test.sh after the baseline.

create table public.funding_news (
  id uuid default gen_random_uuid() not null,
  source text not null,
  -- The canonical article URL: lower-cased host, no query or hash. For
  -- Google News it is the news.google.com redirect, one per article.
  external_key text not null,
  title text not null,
  url text not null,
  -- The feed's publisher (Google News gives "Headline - Publisher"), else null.
  publisher text,
  published_at timestamptz,
  summary text,
  -- The company name guessed from the headline (companyNameFromTitle).
  company_name text,
  amount_text text,
  amount_gbp numeric,
  round text,
  matched_company_search_id uuid,
  match_note text,
  first_seen_at timestamptz default now() not null,
  created_at timestamptz default now() not null,
  constraint funding_news_pkey primary key (id),
  constraint funding_news_external_key_key unique (external_key),
  constraint funding_news_source_check check (source in ('uktn', 'sifted', 'google_news')),
  constraint funding_news_matched_company_fkey foreign key (matched_company_search_id) references public.company_searches(id) on delete set null
);

create index idx_funding_news_published on public.funding_news using btree (published_at desc);
create index idx_funding_news_matched on public.funding_news using btree (matched_company_search_id);

alter table public.funding_news enable row level security;

create policy "App users can read funding_news" on public.funding_news for select to authenticated
  using (public.is_app_user());
create policy "Service role manages funding_news" on public.funding_news for all to public
  using ((auth.role() = 'service_role'::text))
  with check ((auth.role() = 'service_role'::text));

revoke all on table public.funding_news from anon;
revoke all on table public.funding_news from authenticated;
grant select on table public.funding_news to authenticated;
grant all on table public.funding_news to service_role;
