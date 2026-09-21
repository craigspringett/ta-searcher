// Loads the data the signal rules need from the database: open and closed
// vacancy rows, the Companies House register (record, officers, capital
// filings), and the contacts shaped with a role key.

import type { CapitalFilingForSignals, ClosedVacancyForSignals, ContactForSignals, OfficerForSignals, RegisterForSignals, VacancyForSignals } from './compute.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export async function loadVacanciesForSignals(supabase: Supabase, companySearchId: string): Promise<{ open: VacancyForSignals[]; closed: ClosedVacancyForSignals[] }> {
  const { data, error } = await supabase
    .from('vacancies')
    .select('id, title, url, source, first_seen, last_seen, closing_date, status, raw')
    .eq('company_search_id', companySearchId)
    .in('status', ['open', 'closed'])
    .order('first_seen', { ascending: false })
    .limit(300);
  if (error) {
    console.error('vacancies for signals failed:', error.message);
    return { open: [], closed: [] };
  }
  const open: VacancyForSignals[] = [];
  const closed: ClosedVacancyForSignals[] = [];
  for (const r of data || []) {
    if (r.status === 'open') {
      const raw = (r.raw || {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      open.push({
        id: r.id, title: r.title, firstSeen: r.first_seen, closingDate: r.closing_date, source: r.source, url: r.url,
        department: str(raw.department), location: str(raw.location),
        advertText: [raw.description, raw.summary, raw.post].filter((x) => typeof x === 'string').join(' ') || null,
      });
    } else {
      closed.push({ title: r.title, firstSeen: r.first_seen, lastSeen: r.last_seen });
    }
  }
  return { open, closed };
}

/**
 * The register for a company number: status and incorporation date from
 * company_records, every officer from ch_officers (current and resigned,
 * newest appointment first) and the capital filings from ch_filings, newest
 * first. Null when there is no record row (no number, or the register was
 * never read).
 */
export async function loadRegisterForSignals(supabase: Supabase, companyNumber: string | null): Promise<RegisterForSignals | null> {
  if (!companyNumber) return null;
  const [{ data: rec, error: rErr }, { data: officers, error: oErr }, { data: filings, error: fErr }] = await Promise.all([
    supabase.from('company_records').select('status, incorporation_date').eq('company_number', companyNumber).maybeSingle(),
    supabase.from('ch_officers').select('name, role, appointed_on, resigned_on').eq('company_number', companyNumber).order('appointed_on', { ascending: false, nullsFirst: false }).limit(60),
    supabase.from('ch_filings').select('date, type, description').eq('company_number', companyNumber).order('date', { ascending: false }).limit(40),
  ]);
  if (rErr) console.error('company_records read failed:', rErr.message);
  if (oErr) console.error('ch_officers read failed:', oErr.message);
  if (fErr) console.error('ch_filings read failed:', fErr.message);
  if (!rec) return null;
  return {
    status: rec.status ?? null,
    incorporationDate: rec.incorporation_date ?? null,
    officers: ((officers || []) as Array<Record<string, unknown>>).map((o): OfficerForSignals => ({ name: String(o.name || ''), role: String(o.role || ''), appointedOn: (o.appointed_on as string) ?? null, resignedOn: (o.resigned_on as string) ?? null })).filter((o) => o.name),
    capitalFilings: ((filings || []) as Array<Record<string, unknown>>).map((f): CapitalFilingForSignals => ({ date: String(f.date || ''), type: String(f.type || ''), description: String(f.description || '') })).filter((f) => f.date),
  };
}

/**
 * The contacts taxonomy keys (docs/PORT-CONTRACTS.md, Contacts), tested in
 * rank order with the first match winning: a "Co-founder and CTO" is a
 * founder. An assistant is tested first because "EA to the CEO" names the
 * boss, not the post. The contacts module owns the full taxonomy; this is
 * the same word list for a decisionMakers row that carries no roleKey.
 */
const ROLE_KEY_RULES: Array<[RegExp, string]> = [
  [/\b(?:executive assistant|personal assistant|\bea\b|\bpa\b|office manager|assistant to)\b/i, 'ea'],
  [/\b(?:founder|co-founder|cofounder|\bceo\b|chief executive)\b/i, 'founder'],
  [/\b(?:\bcoo\b|chief operating|chief of staff|head of operations|vp,? (?:of )?operations|director of operations)\b/i, 'coo'],
  [/\b(?:\bcto\b|chief technology|chief technical|vp,? (?:of )?engineering|head of engineering|director of engineering)\b/i, 'cto'],
  [/\b(?:chief people officer|\bcpo\b|head of people|vp,? (?:of )?people|director of people|people (?:partner|lead|director|manager|ops|operations|and culture|& culture)|head of hr|hr (?:director|manager|lead|business partner))\b/i, 'people'],
  [/\b(?:head of talent|head of recruit\w*|talent acquisition|talent partner|talent lead|talent manager|director of talent|recruit(?:er|ing|ment)|talent)\b/i, 'talent'],
  [/\b(?:investor|board member|non[- ]executive|\bned\b|partner at|general partner|venture partner|board (?:director|observer|chair)|chair(?:man|woman|person)? of the board|angel)\b/i, 'investor'],
  [/\b(?:chief|\bc[a-z]o\b|\bvp\b|vice president|\bsvp\b|director|head of|president|managing director|general manager)\b/i, 'exec'],
];

/** The taxonomy key for a role text, or null when no rule matches. */
export function roleKeyFromText(role: string | null | undefined): string | null {
  const r = (role || '').trim();
  if (!r) return null;
  for (const [re, key] of ROLE_KEY_RULES) if (re.test(r)) return key;
  return null;
}

/** The decisionMakers list from analysis_result, shaped for the rules: a roleKey from the row when it has one, else from the role text. */
export function contactsForSignals(decisionMakers: Array<{ name?: string | null; role?: string | null; roleKey?: string | null }> | null | undefined): ContactForSignals[] {
  return (decisionMakers || [])
    .filter((d) => d && (d.name || d.role))
    .map((d) => ({ name: String(d.name || '').trim(), role: d.role ? String(d.role).trim() : null, roleKey: d.roleKey ? String(d.roleKey) : roleKeyFromText(d.role) }));
}
