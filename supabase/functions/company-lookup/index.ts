// Find a company by name for the "add a company" form.
// Body: { q: string }. Searches the Companies House register
// (_shared/companies-house.ts) and returns the number, name, status,
// incorporation date and registered office, so the consultant can pick the
// right company and then type or confirm its website. Signed-in users only.
//
// Without COMPANIES_HOUSE_API_KEY the answer is 200 with configured:false
// and a note, so the app can still add the company by URL alone.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { identifyCaller } from '../_shared/auth.ts';
import { companiesHouseConfigured, CompaniesHouseError, NOTE_KEY_NOT_SET, searchCompanies, type CompanySearchHit } from '../_shared/companies-house.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** How many hits the form shows. */
const RESULT_LIMIT = 10;

interface LookupResponse {
  results: CompanySearchHit[];
  configured: boolean;
  note?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ident = await identifyCaller(req, admin);
  if (ident.reject) return ident.reject;
  let q = '';
  try {
    const body = await req.json();
    q = String(body?.q ?? '').trim();
  } catch {
    return json({ error: 'Invalid JSON request body' }, 400);
  }
  if (!companiesHouseConfigured()) return json({ results: [], configured: false, note: NOTE_KEY_NOT_SET } satisfies LookupResponse);
  if (q.length < 3) return json({ results: [], configured: true } satisfies LookupResponse);
  try {
    const results = await searchCompanies(q, RESULT_LIMIT);
    return json({ results, configured: true } satisfies LookupResponse);
  } catch (e) {
    const note = e instanceof CompaniesHouseError ? e.message : `Companies House did not answer (${e instanceof Error ? e.message : String(e)})`;
    console.warn(`[company-lookup] "${q}": ${note}`);
    return json({ results: [], configured: true, note } satisfies LookupResponse);
  }
});
