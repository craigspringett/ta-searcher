-- Follow-up drafts edited by hand and rewritten with the consultant's notes
-- (Craig, 6 October 2026, the same change as He-Giveth): a draft that was
-- edited is kept as written (the tick and a changed company no longer
-- overwrite it), and the notes pasted for a rewrite stay with the step.
ALTER TABLE public.follow_up_steps
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by_name text,
  ADD COLUMN IF NOT EXISTS notes text;
COMMENT ON COLUMN public.follow_up_steps.edited_at IS 'When the draft was last saved by hand; null once TA Searcher writes it again. An edited draft is never overwritten automatically.';
COMMENT ON COLUMN public.follow_up_steps.edited_by_name IS 'Who saved it by hand (display name or email).';
COMMENT ON COLUMN public.follow_up_steps.notes IS 'What was pasted or typed for the rewrite (buyer intent signals, likely-to-buy reasons, own words); used by the next rewrite of this step.';
