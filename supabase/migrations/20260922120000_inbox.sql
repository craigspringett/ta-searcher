-- Outlook inbox reading (22 September 2026, Craig's list): a Microsoft 365
-- connection the consultant approves once, a reader every fifteen minutes
-- that spots a reply from any contact the site has emailed or any address
-- at a tracked company, stops that follow-up run, logs it as replied and
-- drafts an answer in the consultant's tone to copy back into Outlook.
--
-- * mail_connections: one per profile; the refresh token is read by the
--   service role only (column grants: a signed-in user sees the mailbox,
--   the state and the timestamps of their own row, never a token).
-- * oauth_states: the state a sign-in started with, service role only.
-- * inbox_replies: one per matched message; app users read them, may mark
--   one handled; the service role writes the rest.
--
-- Applied by scripts/local-db-test.sh after the pipeline migration.

create table public.mail_connections (
  id uuid default gen_random_uuid() not null,
  profile_id uuid not null,
  provider text default 'microsoft'::text not null,
  mailbox text not null,
  display_name text,
  tenant_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  status text default 'connected'::text not null,
  last_error text,
  -- The newest receivedDateTime read so far; the next read starts there.
  watermark timestamptz,
  connected_at timestamptz default now() not null,
  last_checked_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint mail_connections_pkey primary key (id),
  constraint mail_connections_profile_key unique (profile_id),
  constraint mail_connections_provider_check check (provider in ('microsoft')),
  constraint mail_connections_status_check check (status in ('connected', 'needs_reconnect', 'disconnected')),
  constraint mail_connections_profile_id_fkey foreign key (profile_id) references public.profiles(id) on delete cascade
);
create trigger mail_connections_touch_updated_at before update on public.mail_connections for each row execute function public.touch_updated_at();

create table public.oauth_states (
  state text not null,
  profile_id uuid not null,
  redirect_to text,
  created_at timestamptz default now() not null,
  constraint oauth_states_pkey primary key (state),
  constraint oauth_states_profile_id_fkey foreign key (profile_id) references public.profiles(id) on delete cascade
);

create table public.inbox_replies (
  id uuid default gen_random_uuid() not null,
  connection_id uuid not null,
  -- The message's internet id, so a re-read never makes a second row.
  message_id text not null,
  graph_id text,
  conversation_id text,
  from_email text not null,
  from_name text,
  subject text,
  received_at timestamptz not null,
  preview text,
  body_text text,
  company_search_id uuid,
  contact_name text,
  match_note text,
  sequence_id uuid,
  outcome_id uuid,
  draft_subject text,
  draft_body text,
  draft_flags text[] default '{}'::text[] not null,
  drafted_at timestamptz,
  draft_error text,
  handled_at timestamptz,
  created_at timestamptz default now() not null,
  constraint inbox_replies_pkey primary key (id),
  constraint inbox_replies_message_key unique (connection_id, message_id),
  constraint inbox_replies_connection_id_fkey foreign key (connection_id) references public.mail_connections(id) on delete cascade,
  constraint inbox_replies_company_search_id_fkey foreign key (company_search_id) references public.company_searches(id) on delete cascade,
  constraint inbox_replies_sequence_id_fkey foreign key (sequence_id) references public.follow_up_sequences(id) on delete set null,
  constraint inbox_replies_outcome_id_fkey foreign key (outcome_id) references public.outcomes(id) on delete set null
);
create index idx_inbox_replies_company on public.inbox_replies using btree (company_search_id, received_at desc);
create index idx_inbox_replies_unhandled on public.inbox_replies using btree (received_at desc) where handled_at is null;

alter table public.mail_connections enable row level security;
alter table public.oauth_states enable row level security;
alter table public.inbox_replies enable row level security;

create policy "Users read their own mail connection" on public.mail_connections for select to authenticated
  using (public.is_app_user() and profile_id = auth.uid());
create policy "Service role manages mail connections" on public.mail_connections for all to public
  using ((auth.role() = 'service_role'::text)) with check ((auth.role() = 'service_role'::text));
create policy "Service role manages oauth states" on public.oauth_states for all to public
  using ((auth.role() = 'service_role'::text)) with check ((auth.role() = 'service_role'::text));
create policy "App users read inbox replies" on public.inbox_replies for select to authenticated
  using (public.is_app_user());
create policy "App users mark inbox replies handled" on public.inbox_replies for update to authenticated
  using (public.is_app_user()) with check (public.is_app_user());
create policy "Service role manages inbox replies" on public.inbox_replies for all to public
  using ((auth.role() = 'service_role'::text)) with check ((auth.role() = 'service_role'::text));

revoke all on table public.mail_connections from anon, authenticated;
grant select (id, profile_id, provider, mailbox, display_name, status, last_error, watermark, connected_at, last_checked_at) on table public.mail_connections to authenticated;
grant all on table public.mail_connections to service_role;
revoke all on table public.oauth_states from anon, authenticated;
grant all on table public.oauth_states to service_role;
revoke all on table public.inbox_replies from anon, authenticated;
grant select on table public.inbox_replies to authenticated;
grant update (handled_at) on table public.inbox_replies to authenticated;
grant all on table public.inbox_replies to service_role;
