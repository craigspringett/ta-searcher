-- Follow-ups (ported from He-Giveth on 21 September 2026): sequences. A
-- sequence is a short, dated plan of touches for one company contact
-- (He-Giveth's docs/FOLLOW-UPS-BRIEF.md): day 0 call and email, day 4
-- email, day 8 call, day 14 email. The dates are worked out in
-- Europe/London by _shared/follow-ups/schedule.ts; nothing here sends
-- anything, and every email still goes only when the consultant presses
-- "Approve and send". Behind profiles.features.follow_ups (has_feature()).
--
-- * follow_up_sequences: one row per sequence, with the plan as JSON (the
--   steps with their dates as first worked out, for display) and the
--   contact it is about. One active sequence per company (partial unique
--   index). A company whose sequence finished or stopped in the last eight
--   weeks cannot start another unless something new appeared there
--   (the quiet period; checked by the follow-ups function).
-- * follow_up_steps: one row per touch. status: scheduled (not yet due),
--   due, approved (the consultant pressed Approve and send; the send is in
--   flight), sent, skipped, stopped, done (a call with its outcome logged).
--   The email steps carry their draft (subject, body) and the key of the
--   company context it was written from, so the tick can tell when
--   something changed and write it again.
-- * outcomes.kind already allows emailed, replied and note (the baseline).
--
-- Row security mirrors email_events: managers read every row; a consultant
-- reads the rows for companies on their own lists; the service role writes
-- (the follow-ups, tick-follow-ups and send-outreach-email functions).
--
-- Applied by scripts/local-db-test.sh after the prospects migration.

-- 2. Sequences.
CREATE TABLE IF NOT EXISTS public.follow_up_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_search_id uuid NOT NULL REFERENCES public.company_searches (id) ON DELETE CASCADE,
  consultant_id uuid REFERENCES public.consultants (id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_role text,
  -- The vacancy the sequence is about, when the consultant chose one.
  vacancy_id uuid REFERENCES public.vacancies (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'done')),
  -- Why it stopped, in plain words ("they replied", "not interested", "the address bounced").
  stop_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- When it stopped or finished; the quiet period counts from here.
  ended_at timestamptz,
  -- The plan as first worked out: [{step_no, kind, day, due_at, label}].
  plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS follow_up_sequences_one_active_per_company
  ON public.follow_up_sequences (company_search_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS follow_up_sequences_company ON public.follow_up_sequences (company_search_id, started_at DESC);
CREATE INDEX IF NOT EXISTS follow_up_sequences_status ON public.follow_up_sequences (status);
DROP TRIGGER IF EXISTS follow_up_sequences_touch_updated_at ON public.follow_up_sequences;
CREATE TRIGGER follow_up_sequences_touch_updated_at BEFORE UPDATE ON public.follow_up_sequences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Steps.
CREATE TABLE IF NOT EXISTS public.follow_up_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.follow_up_sequences (id) ON DELETE CASCADE,
  step_no smallint NOT NULL CHECK (step_no BETWEEN 1 AND 20),
  kind text NOT NULL CHECK (kind IN ('call', 'email')),
  -- Day of the plan (0, 4, 8, 14) and what the step is for, for display.
  day smallint NOT NULL DEFAULT 0,
  label text,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'due', 'approved', 'sent', 'skipped', 'stopped', 'done')),
  -- The draft (an email), or the two-line script (the day 8 call).
  subject text,
  body text,
  -- The one concrete thing the draft is about, in a few words.
  hook text,
  draft_generated_at timestamptz,
  -- What the draft was written from (open vacancies, facts, outcomes), so a change is noticed.
  draft_context_key text,
  -- Checks the draft did not pass after one rewrite, for the consultant to see.
  draft_flags text[] NOT NULL DEFAULT '{}',
  -- The send-log message id once sent, and the outcome row the step made.
  sent_message_id text,
  outcome_id uuid REFERENCES public.outcomes (id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_no)
);
CREATE INDEX IF NOT EXISTS follow_up_steps_due ON public.follow_up_steps (due_at) WHERE status IN ('scheduled', 'due');
CREATE INDEX IF NOT EXISTS follow_up_steps_sequence ON public.follow_up_steps (sequence_id, step_no);
DROP TRIGGER IF EXISTS follow_up_steps_touch_updated_at ON public.follow_up_steps;
CREATE TRIGGER follow_up_steps_touch_updated_at BEFORE UPDATE ON public.follow_up_steps FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Row security.
ALTER TABLE public.follow_up_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Managers read follow-up sequences" ON public.follow_up_sequences;
CREATE POLICY "Managers read follow-up sequences" ON public.follow_up_sequences
  FOR SELECT TO authenticated USING (public.is_manager());
DROP POLICY IF EXISTS "Consultants read follow-up sequences for their companies" ON public.follow_up_sequences;
CREATE POLICY "Consultants read follow-up sequences for their companies" ON public.follow_up_sequences
  FOR SELECT TO authenticated USING (
    public.is_app_user()
    AND EXISTS (
      SELECT 1 FROM public.company_consultants sc
      WHERE sc.company_search_id = follow_up_sequences.company_search_id
        AND sc.consultant_id IN (SELECT public.my_consultant_ids())
    )
  );
DROP POLICY IF EXISTS "Service role manages follow-up sequences" ON public.follow_up_sequences;
CREATE POLICY "Service role manages follow-up sequences" ON public.follow_up_sequences
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.follow_up_sequences FROM anon;
GRANT SELECT ON public.follow_up_sequences TO authenticated;
GRANT ALL ON public.follow_up_sequences TO service_role;

ALTER TABLE public.follow_up_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Managers read follow-up steps" ON public.follow_up_steps;
CREATE POLICY "Managers read follow-up steps" ON public.follow_up_steps
  FOR SELECT TO authenticated USING (public.is_manager());
DROP POLICY IF EXISTS "Consultants read follow-up steps for their companies" ON public.follow_up_steps;
CREATE POLICY "Consultants read follow-up steps for their companies" ON public.follow_up_steps
  FOR SELECT TO authenticated USING (
    public.is_app_user()
    AND EXISTS (
      SELECT 1 FROM public.follow_up_sequences s
      JOIN public.company_consultants sc ON sc.company_search_id = s.company_search_id
      WHERE s.id = follow_up_steps.sequence_id
        AND sc.consultant_id IN (SELECT public.my_consultant_ids())
    )
  );
DROP POLICY IF EXISTS "Service role manages follow-up steps" ON public.follow_up_steps;
CREATE POLICY "Service role manages follow-up steps" ON public.follow_up_steps
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.follow_up_steps FROM anon;
GRANT SELECT ON public.follow_up_steps TO authenticated;
GRANT ALL ON public.follow_up_steps TO service_role;
