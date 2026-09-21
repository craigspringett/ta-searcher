// Orchestrates the open-roles sources (the company's confirmed ATS boards
// and its careers page), merges and dedupes them, and persists to the
// `vacancies` table plus the `currentVacancies` JSON the app reads.
import type { AtsBoard, CandidateVacancy, CompanyContext, SourceResult, VacancyRunSummary, VacancySource } from './types.ts';
import { ashbySource } from './source-ashby.ts';
import { greenhouseSource } from './source-greenhouse.ts';
import { leverSource } from './source-lever.ts';
import { workableSource } from './source-workable.ts';
import { careersPageSource } from './source-careers-page.ts';
import { isBlockedTitle, looksLikeRoleTitle } from './blocklist.ts';
import { classifyDocument, DOCUMENT_LABELS, samePost, staleDocumentReason, type DocumentKind } from './documents.ts';
import { roleFamily, type RoleFamily } from './role-family.ts';
import { cleanTitle, normaliseTitle, vacancyKey } from '../vacancy-identity.ts';
import { isPastIso, todayIso } from '../dates.ts';

export const SOURCE_PRIORITY: Record<VacancySource, number> = { ashby: 0, greenhouse: 1, lever: 2, workable: 3, careers_page: 4, consultant: 5, llm: 6, other: 7 };
const SOURCE_BUDGET_MS = 45000;

/** The sources that read a page rather than a feed: never closed by a degraded run, and their titles need a job noun. */
const PAGE_SOURCES: VacancySource[] = ['careers_page', 'llm'];

function withBudget(p: Promise<SourceResult>, source: VacancySource): Promise<SourceResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<SourceResult>((resolve) => {
    timer = setTimeout(() => resolve({ source, ok: false, vacancies: [], note: `exceeded ${SOURCE_BUDGET_MS}ms budget`, ms: SOURCE_BUDGET_MS }), SOURCE_BUDGET_MS);
  });
  return Promise.race([p, budget]).finally(() => clearTimeout(timer));
}

/** One source call per confirmed board. */
export function boardSources(boards: AtsBoard[], today: Date): Promise<SourceResult>[] {
  return (boards || []).map((b) => {
    switch (b.provider) {
      case 'ashby': return withBudget(ashbySource(b, today), 'ashby');
      case 'greenhouse': return withBudget(greenhouseSource(b, today), 'greenhouse');
      case 'lever': return withBudget(leverSource(b, today), 'lever');
      case 'workable': return withBudget(workableSource(b, today), 'workable');
      default: return Promise.resolve<SourceResult>({ source: 'other', ok: false, vacancies: [], note: `unknown provider ${(b as AtsBoard).provider}`, ms: 0 });
    }
  });
}

/** Every source: the confirmed boards in ctx.boards plus the careers page. `supabase` is unused here and kept for the call shape. */
export async function collectVacancies(_supabase: any, ctx: CompanyContext, homepageHtml: string, today: Date = new Date()): Promise<SourceResult[]> {
  return await Promise.all([
    ...boardSources(ctx.boards, today),
    withBudget(careersPageSource(ctx, { homepageHtml, today }), 'careers_page'),
  ]);
}

/** The confirmed boards only, for the nightly sync and for a run whose homepage did not answer. */
export async function collectBoardVacancies(_supabase: any, ctx: CompanyContext, today: Date = new Date()): Promise<SourceResult[]> {
  return await Promise.all(boardSources(ctx.boards, today));
}

export interface MergedVacancy extends CandidateVacancy {
  key: string;
  sources: VacancySource[];
}

export interface MergeOutcome {
  kept: MergedVacancy[];
  dropped: Array<{ title: string; source: VacancySource; reason: string }>;
}

/** A supporting document found beside the roles, waiting for the post it belongs to. */
interface PendingDocument {
  candidate: CandidateVacancy;
  title: string;
  post: string;
  kind: DocumentKind;
}

/** Fill what `into` lacks from `v`: the feed fields, dates, the other URL. */
function fillFrom(into: MergedVacancy, v: CandidateVacancy) {
  if (!into.closingDate && v.closingDate) into.closingDate = v.closingDate;
  if (!into.startText && v.startText) into.startText = v.startText;
  if (!into.url && v.url) into.url = v.url;
  if (!into.datePosted && v.datePosted) into.datePosted = v.datePosted;
  if (!into.department && v.department) into.department = v.department;
  if (!into.location && v.location) into.location = v.location;
  if (!into.workplaceType && v.workplaceType) into.workplaceType = v.workplaceType;
  if (!into.employmentType && v.employmentType) into.employmentType = v.employmentType;
}

/** Fold `v` into `into`: sources, dates, the other URL; record why. */
function absorb(into: MergedVacancy, v: MergedVacancy, dropped: MergeOutcome['dropped'], reason: string) {
  for (const src of v.sources) if (!into.sources.includes(src)) into.sources.push(src);
  fillFrom(into, v);
  const alsoSeenAt = [...(((into.raw || {}) as any).alsoSeenAt || []), v.url].filter(Boolean);
  into.raw = { ...(into.raw || {}), alsoSeenAt };
  dropped.push({ title: v.title, source: v.source, reason });
}

export function mergeVacancies(candidates: CandidateVacancy[], _ctx: Pick<CompanyContext, 'name'> | null = null, today: Date = new Date()): MergeOutcome {
  const byKey = new Map<string, MergedVacancy>();
  const dropped: MergeOutcome['dropped'] = [];
  const documents: PendingDocument[] = [];
  const sorted = [...candidates].sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
  for (const c of sorted) {
    let title = cleanTitle(c.title);
    if (!title) continue;
    const fromPage = PAGE_SOURCES.includes(c.source);
    // A careers-page document dated more than 60 days ago (in its title, its
    // upload path or its Last-Modified header) is not a new role.
    if (fromPage) {
      const stale = staleDocumentReason(title, c.url, today, undefined, c.lastModified);
      if (stale) {
        dropped.push({ title, source: c.source, reason: stale });
        continue;
      }
    }
    // Documents about a post never become roles; they wait for the advert.
    const doc = c.document ? { kind: c.document, post: c.post || classifyDocument(title).post, supporting: true } : (fromPage ? classifyDocument(title) : { kind: null, post: title, supporting: false });
    if (doc.supporting && doc.kind) {
      documents.push({ candidate: c, title, post: doc.post, kind: doc.kind });
      continue;
    }
    // "Senior Engineer Advert" is the advert: keep the post name.
    const originalTitle = title;
    if (doc.kind === 'advert' && doc.post && looksLikeRoleTitle(doc.post, c.source)) title = doc.post;
    const block = isBlockedTitle(title);
    if (block.blocked) {
      dropped.push({ title, source: c.source, reason: block.reason || 'blocked' });
      continue;
    }
    if (fromPage && !looksLikeRoleTitle(title, c.source)) {
      dropped.push({ title, source: c.source, reason: 'no job noun in title' });
      continue;
    }
    if (c.closingDate && isPastIso(c.closingDate, today)) {
      dropped.push({ title, source: c.source, reason: `closing date ${c.closingDate} has passed` });
      continue;
    }
    const key = vacancyKey({ title, url: c.url, pageUrl: c.pageUrl });
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.sources.includes(c.source)) existing.sources.push(c.source);
      fillFrom(existing, c);
      continue;
    }
    const raw = originalTitle !== title ? { ...(c.raw || {}), originalTitle } : c.raw;
    byKey.set(key, { ...c, title, key, sources: [c.source], raw, document: null, post: null });
  }
  // The same role on the feed and the careers page has two URLs: collapse
  // identical titles within this company, keeping the higher-priority source.
  const byTitle = new Map<string, MergedVacancy>();
  for (const v of byKey.values()) {
    const t = normaliseTitle(v.title);
    const existing = byTitle.get(t);
    if (!existing) {
      byTitle.set(t, v);
      continue;
    }
    absorb(existing, v, dropped, `same title as ${existing.source} listing`);
  }
  // Near-identical titles ("Senior Engineer" and "Senior Engineer - London")
  // are one post when they come from different sources. Two postings on one
  // feed with the same words are two roles (the feed keys them apart) and
  // are left alone.
  const kept: MergedVacancy[] = [];
  for (const v of byTitle.values()) {
    const existing = kept.find((k) => k.source !== v.source && samePost(k.title, v.title));
    if (!existing) {
      kept.push(v);
      continue;
    }
    absorb(existing, v, dropped, `near-identical to ${existing.source} listing "${existing.title}"`);
  }
  // A job description, form or pack joins the advert for its post as a
  // document, or goes when there is none.
  for (const d of documents) {
    const label = DOCUMENT_LABELS[d.kind];
    const advert = kept.find((k) => samePost(d.post, k.title));
    if (!advert) {
      dropped.push({ title: d.title, source: d.candidate.source, reason: `${label} with no advert for the post` });
      continue;
    }
    const docs = [...((((advert.raw || {}) as any).documents as unknown[]) || []), { kind: d.kind, title: d.title, url: d.candidate.url ?? d.candidate.pageUrl ?? null }];
    advert.raw = { ...(advert.raw || {}), documents: docs };
    if (!advert.closingDate && d.candidate.closingDate) advert.closingDate = d.candidate.closingDate;
    dropped.push({ title: d.title, source: d.candidate.source, reason: `${label} for "${advert.title}"` });
  }
  return { kept, dropped };
}

export interface PersistedVacancy {
  id: string;
  key: string;
  title: string;
  url: string | null;
  source: VacancySource;
  closingDate: string | null;
  startText: string | null;
  firstSeen: string;
  lastSeen: string;
  status: string;
  datePosted: string | null;
  department: string | null;
  location: string | null;
  workplaceType: string | null;
  employmentType: string | null;
}

export interface PersistOptions {
  companySearchId: string;
  today?: Date;
  degraded: boolean;
  /**
   * For a degraded run, or a boards-only run (the nightly sync): the feed
   * sources that answered. Their rows are upserted and their missing rows
   * closed; rows from any other source (the careers page above all) are
   * left as they are, because nothing this run saw can say they are gone.
   */
  closeSources?: VacancySource[];
}

interface ExistingRow {
  id: string;
  vacancy_key: string;
  title: string;
  url: string | null;
  status: string;
  rejected_reason: string | null;
  first_seen: string;
  last_seen: string;
  closing_date: string | null;
}

const REAPPEAR_AFTER_DAYS = 30;

/** A row a consultant marked "Closed" from an alert email. */
function consultantClosed(r: ExistingRow): boolean {
  return r.status === 'closed' && !!r.rejected_reason && r.rejected_reason.startsWith('Consultant reported');
}

/**
 * The stored row an incoming role is the same posting as, when their keys
 * differ: a baseline row keyed `title:` that a feed now lists with a URL, or
 * a posting that moved (the careers page link became the Ashby link). Same
 * normalised title at the same company, and the same closing date when both
 * have one. Open rows first, then rejected (a consultant's decision stands),
 * then the most recently seen closed row.
 */
export function findSameAdvert(incoming: { title: string; closingDate?: string | null }, existing: ExistingRow[]): ExistingRow | null {
  const want = normaliseTitle(incoming.title);
  if (!want) return null;
  const rank: Record<string, number> = { open: 0, rejected: 1, closed: 2 };
  const candidates = existing
    .filter((r) => normaliseTitle(r.title) === want)
    .filter((r) => !(incoming.closingDate && r.closing_date && incoming.closingDate !== r.closing_date))
    .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (b.last_seen < a.last_seen ? -1 : b.last_seen > a.last_seen ? 1 : 0));
  return candidates[0] ?? null;
}

/** Upsert merged roles; close rows not seen this run unless degraded. Returns the open rows. */
export async function persistVacancies(supabase: any, merged: MergedVacancy[], opts: PersistOptions): Promise<PersistedVacancy[]> {
  const today = todayIso(opts.today ?? new Date());
  const closeSources: VacancySource[] | null = opts.degraded ? (opts.closeSources ?? []).filter((s) => !PAGE_SOURCES.includes(s) && s !== 'consultant') : null;
  if (!opts.degraded || (closeSources && closeSources.length)) {
    const rows = merged.filter((m) => !closeSources || closeSources.includes(m.source)).map((m) => ({
      company_search_id: opts.companySearchId,
      vacancy_key: m.key,
      title: m.title,
      url: m.url ?? m.pageUrl ?? null,
      source: m.source,
      employer_name: m.employerName ?? null,
      closing_date: m.closingDate ?? null,
      start_text: m.startText ?? null,
      last_seen: today,
      status: 'open',
      raw: {
        ...(m.raw || {}),
        sources: m.sources,
        datePosted: m.datePosted ?? null,
        department: m.department ?? null,
        location: m.location ?? null,
        workplaceType: m.workplaceType ?? null,
        employmentType: m.employmentType ?? null,
        postcode: m.postcode ?? null,
      },
    }));
    // Keys the close step leaves open. A row re-keyed below carries one of
    // these keys afterwards, so it stays open too.
    const keepKeys = new Set(merged.map((m) => m.key));
    if (rows.length) {
      // Rejected rows stay rejected. A role that re-appears after being
      // closed for 30+ days counts as new again (first_seen reset).
      const { data: existingData, error: readErr } = await supabase
        .from('vacancies')
        .select('id, vacancy_key, title, url, status, rejected_reason, first_seen, last_seen, closing_date')
        .eq('company_search_id', opts.companySearchId);
      if (readErr) throw new Error(`vacancies read failed: ${readErr.message}`);
      const existingRows = (existingData || []) as ExistingRow[];
      const byKey = new Map(existingRows.map((r) => [r.vacancy_key, r]));
      const nowMs = (opts.today ?? new Date()).getTime();
      const cutoff = todayIso(new Date(nowMs - REAPPEAR_AFTER_DAYS * 86400000));

      // When a consultant said "Closed": the date they said it. The row stays
      // closed for 30 days while the posting is still up, then counts as new.
      const closedByConsultantAt = new Map<string, number>();
      const consultantClosedIds = existingRows.filter(consultantClosed).map((r) => r.id);
      if (consultantClosedIds.length) {
        const { data: feedback } = await supabase
          .from('vacancy_feedback')
          .select('vacancy_id, created_at')
          .eq('kind', 'closed')
          .in('vacancy_id', consultantClosedIds);
        for (const f of feedback || []) {
          const at = new Date(f.created_at).getTime();
          if (!closedByConsultantAt.has(f.vacancy_id) || closedByConsultantAt.get(f.vacancy_id)! < at) closedByConsultantAt.set(f.vacancy_id, at);
        }
      }
      /** How the incoming row is stored, given the row it matches. */
      const resolveStatus = (match: ExistingRow | null, r: any): { row: any; reopened: boolean } => {
        if (!match) {
          // A new row: the feed's posting date is when the role opened, so
          // "open more than five weeks" is right from the first read.
          const posted = typeof r.raw?.datePosted === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.raw.datePosted) ? r.raw.datePosted : null;
          return { row: posted && posted < today ? { ...r, first_seen: posted } : r, reopened: false };
        }
        if (match.status === 'rejected') return { row: { ...r, status: 'rejected' }, reopened: false };
        if (consultantClosed(match)) {
          const at = closedByConsultantAt.get(match.id);
          const recent = at !== undefined && nowMs - at < REAPPEAR_AFTER_DAYS * 86400000;
          if (recent) return { row: { ...r, status: 'closed' }, reopened: false };
          return { row: { ...r, first_seen: today, rejected_reason: null }, reopened: true };
        }
        if (match.status === 'closed' && match.last_seen < cutoff) return { row: { ...r, first_seen: today }, reopened: true };
        return { row: r, reopened: false };
      };
      const claimed = new Set<string>();
      const toUpsert: any[] = [];
      const reopenedIds: string[] = [];
      for (const r of rows) {
        let match = byKey.get(r.vacancy_key) ?? null;
        let rekeyed = false;
        if (!match) {
          // Same posting under a different key: keep the stored row (and its
          // first_seen) and move it to the new key instead of inserting.
          match = findSameAdvert({ title: r.title, closingDate: r.closing_date }, existingRows.filter((e) => !claimed.has(e.id) && !keepKeys.has(e.vacancy_key)));
          rekeyed = !!match;
        }
        if (match) claimed.add(match.id);
        const { row, reopened } = resolveStatus(match, r);
        if (reopened && match) reopenedIds.push(match.id);
        if (!rekeyed) {
          toUpsert.push(row);
          continue;
        }
        const { error: rekeyErr } = await supabase
          .from('vacancies')
          .update({ ...row, raw: { ...row.raw, rekeyedFrom: match!.vacancy_key, rekeyedOn: today } })
          .eq('id', match!.id);
        if (rekeyErr) throw new Error(`vacancies re-key failed: ${rekeyErr.message}`);
        console.log(`[persist] re-keyed "${r.title}" ${match!.vacancy_key} -> ${r.vacancy_key} (first seen ${match!.first_seen})`);
      }
      if (toUpsert.length) {
        const { error } = await supabase.from('vacancies').upsert(toUpsert, { onConflict: 'company_search_id,vacancy_key' });
        if (error) throw new Error(`vacancies upsert failed: ${error.message}`);
      }
      if (reopenedIds.length) {
        // New again: forget earlier deliveries so the alert goes out once more.
        const { error: relErr } = await supabase.from('alert_deliveries').delete().in('vacancy_id', reopenedIds);
        if (relErr) console.error(`alert_deliveries release failed: ${relErr.message}`);
        console.log(`[persist] reopened ${reopenedIds.length} vacancy row(s) as new after ${REAPPEAR_AFTER_DAYS}+ days`);
      }
    }
    const keys = Array.from(keepKeys);
    // A role the team typed in (source consultant) is never closed by a refresh: the consultant closes it.
    let closeQuery = supabase.from('vacancies').update({ status: 'closed' }).eq('company_search_id', opts.companySearchId).eq('status', 'open').neq('source', 'consultant');
    if (closeSources) closeQuery = closeQuery.in('source', closeSources);
    if (keys.length) closeQuery = closeQuery.not('vacancy_key', 'in', `(${keys.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(',')})`);
    const { error: closeErr } = await closeQuery;
    if (closeErr) throw new Error(`vacancies close failed: ${closeErr.message}`);
  }
  const { data, error } = await supabase
    .from('vacancies')
    .select('id, vacancy_key, title, url, source, closing_date, start_text, first_seen, last_seen, status, raw')
    .eq('company_search_id', opts.companySearchId)
    .eq('status', 'open')
    .order('first_seen', { ascending: false });
  if (error) throw new Error(`vacancies read failed: ${error.message}`);
  return (data || []).map((r: any) => persistedOf(r));
}

/** A PersistedVacancy from a vacancies row (the feed fields live in raw). */
export function persistedOf(r: any): PersistedVacancy {
  const raw = (r.raw || {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    id: r.id,
    key: r.vacancy_key,
    title: r.title,
    url: r.url,
    source: r.source,
    closingDate: r.closing_date,
    startText: r.start_text,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    status: r.status,
    datePosted: str(raw.datePosted),
    department: str(raw.department),
    location: str(raw.location),
    workplaceType: str(raw.workplaceType),
    employmentType: str(raw.employmentType),
  };
}

export const SOURCE_LABELS: Record<VacancySource, string> = {
  ashby: 'Ashby',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workable: 'Workable',
  careers_page: 'Careers page',
  llm: 'Page read',
  consultant: 'Typed in',
  other: 'Other',
};

export interface CurrentVacancy {
  title: string;
  url: string | undefined;
  source: VacancySource;
  sourceLabel: string;
  firstSeen: string;
  datePosted: string | null;
  department: string | null;
  location: string | null;
  workplaceType: string | null;
  family: RoleFamily;
  /** The row id, for the feedback links and the calls history. */
  vacancyId: string;
}

/** The JSON shape the frontend reads (analysis_result.recruitmentInsights.currentVacancies). */
export function toCurrentVacancies(rows: PersistedVacancy[]): CurrentVacancy[] {
  return rows.map((r) => ({
    title: r.title,
    url: r.url || undefined,
    source: r.source,
    sourceLabel: SOURCE_LABELS[r.source] || r.source,
    firstSeen: r.firstSeen,
    datePosted: r.datePosted ?? null,
    department: r.department ?? null,
    location: r.location ?? null,
    workplaceType: r.workplaceType ?? null,
    family: roleFamily(r.title, r.department),
    vacancyId: r.id,
  }));
}

export function summariseRun(results: SourceResult[], kept: MergedVacancy[], homepageOk: boolean, previousOpenCount: number, extra: Record<string, unknown> = {}): VacancyRunSummary {
  const sourcesTried = results.map((r) => r.source);
  const sourcesOk = results.filter((r) => r.ok).map((r) => r.source);
  let degraded = false;
  let degradedReason: string | undefined;
  if (!homepageOk) {
    degraded = true;
    degradedReason = 'homepage fetch failed';
  } else if (results.length && sourcesOk.length === 0) {
    degraded = true;
    degradedReason = 'all sources failed';
  } else if (kept.length === 0 && previousOpenCount >= 3) {
    degraded = true;
    degradedReason = `found 0 roles but previous run had ${previousOpenCount}`;
  }
  return {
    sourcesTried,
    sourcesOk,
    vacanciesFound: kept.length,
    degraded,
    degradedReason,
    notes: {
      sources: Object.fromEntries(results.map((r) => [r.source, { ok: r.ok, found: r.vacancies.length, ms: r.ms, note: r.note }])),
      ...extra,
    },
  };
}
