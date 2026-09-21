import { identifyCaller } from '../_shared/auth.ts';
import { isDefunctStatus } from '../_shared/companies-house.ts';
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ENQUEUE_CHUNK_SIZE = 12;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Dispatch strategy: enqueue analyze-company calls via pg_net.http_post inside
// Postgres. Each call goes through the pg_net background worker (independent
// of the Supabase function-gateway sub-invocation quota that previously
// rate-limited us when fanning out 171 calls from one parent invocation).
// Each fetch is fire-and-forget — analyze-company persists results itself
// when isRefresh=true.

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, callerClient);
  if (ident.reject) return ident.reject;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Optional filter for verification runs: { "companyIds": ["<uuid>", ...] }
    // queues only those rows (still through the queue and the paced
    // dispatcher) instead of every company the alert configs cover.
    let onlyCompanyIds: Set<string> | null = null;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        const ids = Array.isArray(body?.companyIds) ? body.companyIds : [];
        const valid = ids.filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
        if (valid.length > 0) onlyCompanyIds = new Set(valid.map((x: string) => x.toLowerCase()));
      } catch {
        // No body or not JSON: the cron call sends '{}' and the app sends nothing.
      }
    }

    // Phase 4 hotfix, item 6: from the app, a refresh names its companies
    // (the filtered list), at most 50 at a time unless a manager asks, and
    // at most 200 an hour per person; the whole estate is the schedule's.
    const USER_BATCH_CAP = 50;
    const USER_HOURLY_CAP = 200;
    if (ident.caller.kind === 'user') {
      const isManager = ident.caller.profile.role === 'manager' || ident.caller.profile.role === 'admin';
      if (!onlyCompanyIds) return new Response(JSON.stringify({ error: 'Pick the companies to refresh; the whole list is refreshed by the nightly schedule.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (!isManager && onlyCompanyIds.size > USER_BATCH_CAP) return new Response(JSON.stringify({ error: `Refresh up to ${USER_BATCH_CAP} companies at a time; narrow the filter or ask a manager.` }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase.from('analyze_company_requests').select('id', { count: 'exact', head: true }).eq('user_id', ident.caller.userId).gte('created_at', since).like('company_url', 'bulk:%');
      if ((count ?? 0) + onlyCompanyIds.size > USER_HOURLY_CAP) return new Response(JSON.stringify({ error: `You have queued ${count ?? 0} companies in the last hour; the limit is ${USER_HOURLY_CAP}. Try again later.` }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '900' } });
    }

    // Phase 4 hotfix, item 4: a consultant switched off on the Consultants
    // page has their companies left out of the nightly refresh.
    const { data: consultantRows, error: consErr } = await supabase.from('consultants').select('id, name, active');
    if (consErr) throw consErr;
    const inactiveIds = new Set<string>((consultantRows || []).filter((c: any) => c.active === false).map((c: any) => c.id));
    const inactiveNames = new Set<string>((consultantRows || []).filter((c: any) => c.active === false).map((c: any) => String(c.name).trim().toLowerCase()));

    // 1. Find all consultants with enabled new_vacancy alerts
    const { data: configs, error: configError } = await supabase
      .from('vacancy_alert_settings')
      .select('consultant_filter, consultant_id')
      .eq('enabled', true)
      .eq('auto_refresh_enabled', true)
      .eq('alert_type', 'new_vacancy');

    if (configError) throw configError;

    // A new_vacancy config with no consultant filter means "all companies".
    const refreshEverything = (configs || []).some((c: any) => !c.consultant_filter || !c.consultant_filter.trim());
    if (refreshEverything) console.log('[refresh-all-companies] a new_vacancy config has consultant_filter = null: refreshing all companies');

    const targetConsultants = new Set<string>();
    const targetConsultantIds = new Set<string>();
    for (const c of configs || []) {
      if (c.consultant_id && inactiveIds.has(c.consultant_id)) continue;
      if (!c.consultant_id && c.consultant_filter && inactiveNames.has(c.consultant_filter.trim().toLowerCase())) continue;
      if (c.consultant_id) targetConsultantIds.add(c.consultant_id);
      else if (c.consultant_filter && c.consultant_filter.trim()) targetConsultants.add(c.consultant_filter.trim().toLowerCase());
    }
    // Phase 4: assignments live in company_consultants; the tag is the fallback.
    const assigned = new Map<string, Set<string>>();
    if (targetConsultantIds.size) {
      const { data: rows, error: aErr } = await supabase.from('company_consultants').select('company_search_id, consultant_id').in('consultant_id', [...targetConsultantIds]);
      if (aErr) throw aErr;
      for (const r of rows || []) {
        if (!assigned.has(r.company_search_id)) assigned.set(r.company_search_id, new Set());
        assigned.get(r.company_search_id)!.add(r.consultant_id);
      }
    }

    if (targetConsultants.size === 0 && targetConsultantIds.size === 0 && !refreshEverything && !onlyCompanyIds) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No enabled new_vacancy alert configs — nothing to refresh',
        refreshed: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2. Pull all companies and filter to those whose consultant matches
    const { data: companies, error: companyError } = await supabase
      .from('company_searches')
      .select('id, company_name, url, company_number, analysis_result');

    if (companyError) throw companyError;

    const matching = (companies || []).filter((s: any) => {
      // A company dissolved or in liquidation on the register is never refreshed again.
      if (isDefunctStatus(s.analysis_result?.companyRecord?.status ?? null) && !onlyCompanyIds) return false;
      if (onlyCompanyIds) return onlyCompanyIds.has(String(s.id).toLowerCase());
      if (refreshEverything) return true;
      if (assigned.has(s.id)) return true;
      const c = s.analysis_result?.consultant;
      if (!c) return false;
      const consultants = String(c).split(',').map((x: string) => x.trim().toLowerCase());
      return consultants.some((x: string) => targetConsultants.has(x));
    });

    if (matching.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No companies match the consultants with enabled new_vacancy alerts',
        consultants: Array.from(targetConsultants),
        refreshed: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[refresh-all-companies] Refreshing ${matching.length} companies across ${targetConsultants.size} consultants`);

    // Count a person's queued companies towards their hourly allowance (the
    // direct analyses keep their own limit of ten; these rows are marked).
    if (ident.caller.kind === 'user') {
      const userId = ident.caller.userId;
      const { error: reqErr } = await supabase.from('analyze_company_requests').insert(matching.map((s: any) => ({ user_id: userId, company_url: `bulk:${s.id}` })));
      if (reqErr) console.warn('[refresh-all-companies] could not record the request:', reqErr.message);
    }

    // 3. Hand the dispatch off to Postgres via pg_net.http_post.
    //    Calling enqueue_analyze_company_batch is a SINGLE sub-invocation from
    //    this edge function's perspective, so we never trip the function-gateway
    //    rate limiter. Inside the RPC, Postgres queues N independent HTTP
    //    requests on the pg_net background worker — each request is dispatched
    //    by Postgres with no shared sub-invocation quota.
    const targetUrl = `${supabaseUrl}/functions/v1/analyze-company`;
    // companyId lets analyze-company update the row by primary key; it never
    // inserts or renames on the refresh path.
    const payloads = matching.map((s: any) => ({
      companyId: s.id,
      url: s.url,
      companyName: s.company_name,
      companyNumber: s.company_number,
      consultant: s.analysis_result?.consultant || null,
      isRefresh: true,
    }));

    const refreshTask = (async () => {
      const start = Date.now();
      const payloadChunks = chunkArray(payloads, ENQUEUE_CHUNK_SIZE);
      let totalEnqueued = 0;

      for (const [index, chunk] of payloadChunks.entries()) {
        const { data, error } = await supabase.rpc('enqueue_analyze_company_batch', {
          payloads: chunk,
          target_url: targetUrl,
          auth_token: supabaseKey,
        });

        if (error) {
          console.error(
            `[refresh-all-companies] enqueue_analyze_company_batch failed on chunk ${index + 1}/${payloadChunks.length}:`,
            error.message,
          );
          return;
        }

        totalEnqueued += Number(data || 0);
        console.log(
          `[refresh-all-companies] Enqueued chunk ${index + 1}/${payloadChunks.length} (${Number(data || 0)} companies, total ${totalEnqueued}).`,
        );
      }

      console.log(`[refresh-all-companies] Enqueued ${totalEnqueued} analyze-company requests via pg_net in ${Math.round((Date.now() - start) / 1000)}s. Background analyses will run independently.`);
    })();

    if (typeof EdgeRuntime !== 'undefined') {
      EdgeRuntime.waitUntil(refreshTask);
    } else {
      refreshTask.catch((e) => console.error('[refresh-all-companies] background task error:', e));
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Refresh started in background',
      companyCount: matching.length,
      consultants: Array.from(targetConsultants),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[refresh-all-companies] Error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
