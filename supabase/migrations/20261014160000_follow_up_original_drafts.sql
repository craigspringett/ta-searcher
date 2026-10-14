-- Follow-up drafts keep the first version the writer produced (14 October
-- 2026, Craig: "take note of the edits I made so you get to know my style").
-- An edit by hand or a changed email at send time used to overwrite the draft,
-- so the writer could not see what Craig changed. The first time a step is
-- edited the draft is copied here, once; later edits leave it alone.
alter table public.follow_up_steps
  add column if not exists original_subject text,
  add column if not exists original_body text;
