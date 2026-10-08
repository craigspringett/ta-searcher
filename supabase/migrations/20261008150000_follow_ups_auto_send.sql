-- Follow-up emails that send themselves on their days (Craig, 8 October
-- 2026, the same change as He-Giveth). Per sequence, opt-in; only a clean
-- draft (no checks failed) or one edited by hand goes by itself; a manager
-- can switch it off for everyone (app_settings follow_ups.auto_send).
ALTER TABLE public.follow_up_sequences
  ADD COLUMN IF NOT EXISTS auto_send boolean NOT NULL DEFAULT false;
ALTER TABLE public.follow_up_steps
  ADD COLUMN IF NOT EXISTS sent_automatically boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_note text;
COMMENT ON COLUMN public.follow_up_sequences.auto_send IS 'The emails go by themselves at their due time when the draft is clean or hand-edited; otherwise they wait for Approve and send.';
COMMENT ON COLUMN public.follow_up_steps.sent_automatically IS 'True when the tick sent this email rather than a person.';
COMMENT ON COLUMN public.follow_up_steps.auto_attempted_at IS 'When the tick last tried to send this email by itself; with auto_note, why it did not go.';
INSERT INTO public.app_settings (key, value) VALUES ('follow_ups', '{"auto_send": true}'::jsonb) ON CONFLICT (key) DO NOTHING;
