-- TA Searcher seed: the app_settings rows the code reads, with the defaults
-- the code would assume anyway, so the Alerts page has rows to edit.
-- Applied by `supabase db reset` locally; on the hosted project run it once
-- through scripts/sb-sql.sh -f supabase/seed.sql. Idempotent.
--
--   brief_copy_recipients  addresses copied on every consultant's Friday brief
--   engagement_alerts      open and click alerts to the sending consultant
--   sending_domains        domains a consultant may send from as themselves
--                          (the notify sub-domain only until the brand's own
--                          domain is verified in Resend; see the brief's
--                          question 1 to Craig)

insert into public.app_settings (key, value) values
  ('brief_copy_recipients', '[]'::jsonb),
  ('engagement_alerts', '{"enabled": true, "opens": true, "clicks": true, "off_for": []}'::jsonb),
  ('sending_domains', '["notify.whofoundwho.co.uk"]'::jsonb)
on conflict (key) do nothing;

-- The email queue's one state row (the baseline inserts it too; harmless here).
insert into public.email_send_state (id) values (1) on conflict do nothing;
