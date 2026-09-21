// Returns cron job status + email counters for the vacancy alert pipeline dashboard.
// Strategy: cheap job-definitions list (includes jobid), then per-job indexed
// lookups in parallel. Each per-job RPC has a 4s server-side statement timeout
// so a slow scan can never block the dashboard — we just show "no data".
import { identifyCaller } from '../_shared/auth.ts';
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface JobRow {
  key: string;
  label: string;
  jobname: string;
  jobid: number | null;
  schedule: string | null;
  active: boolean;
  configured: boolean;
  lastRun: any;
  recentRuns: any[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, callerClient);
  if (ident.reject) return ident.reject;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Job definitions (includes jobid). Fast — no history scan.
    let jobs: JobRow[] = [];
    try {
      const { data, error } = await supabase.rpc("get_cron_monitoring_jobs_only");
      if (error) throw error;
      jobs = (data ?? []) as JobRow[];
    } catch (e) {
      console.error("jobs_only RPC failed", e);
    }

    // 2) Per-job recent runs in parallel (each capped at 4s server-side).
    await Promise.all(
      jobs.map(async (j) => {
        if (!j.jobid) return;
        try {
          const [{ data: last }, { data: recent }] = await Promise.all([
            supabase.rpc("get_cron_last_run", { p_jobid: j.jobid }),
            supabase.rpc("get_cron_recent_runs", { p_jobid: j.jobid, p_limit: 5 }),
          ]);
          j.lastRun = last ?? null;
          j.recentRuns = Array.isArray(recent) ? recent : [];
        } catch (e) {
          console.error("per-job lookup failed", j.jobname, e);
        }
      }),
    );

    // 3) Email counters
    let counters: Record<string, any> = {};
    let byDay: Record<string, any> = {};
    try {
      const { data, error } = await supabase.rpc("get_vacancy_email_counters");
      if (error) throw error;
      counters = data?.counters ?? {};
      byDay = data?.byDay ?? {};
    } catch (e) {
      console.error("email counters failed", e);
    }

    // 4) Pipeline health (companies refreshed today, degraded runs, snapshot age,
    //    per-config new counts, DLQ depth, the ATS and register syncs).
    let pipeline: Record<string, any> | null = null;
    try {
      const { data, error } = await supabase.rpc("get_pipeline_health");
      if (error) throw error;
      pipeline = data ?? null;
    } catch (e) {
      console.error("pipeline health failed", e);
    }

    // 5) AI spend: tokens and estimated cost by day and model.
    let aiUsage: Record<string, any> | null = null;
    try {
      const { data, error } = await supabase.rpc("get_ai_usage_summary");
      if (error) throw error;
      aiUsage = data ?? null;
    } catch (e) {
      console.error("ai usage summary failed", e);
    }

    return new Response(
      JSON.stringify({
        jobs,
        emailCounters: counters,
        emailsByDay: byDay,
        pipeline,
        aiUsage,
        generatedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("cron-monitoring error", err);
    const message = err?.message || (typeof err === "string" ? err : JSON.stringify(err));
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
