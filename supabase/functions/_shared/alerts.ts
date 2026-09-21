// Shared pieces of the alert pipeline: config scoping, card building, sending
// with a dry-run switch.
import { formatIsoDateUk } from './dates.ts';
import { feedbackSecret, feedbackUrl } from './feedback-token.ts';
import { SOURCE_LABELS } from './vacancies/pipeline.ts';
import type { VacancyCardItem } from './transactional-email-templates/vacancy-card.tsx';

/** The app's address, for links in email; set APP_BASE_URL on the project once the site has its domain. */
export const APP_BASE_URL = Deno.env.get('APP_BASE_URL') || 'https://ta-searcher.netlify.app';

export interface AlertConfig {
  id: string;
  name: string | null;
  email: string | null;
  alert_type: string;
  /** Legacy tag filter; consultant_id wins when set. */
  consultant_filter: string | null;
  enabled: boolean;
  auto_refresh_enabled: boolean;
  daily_alerts: boolean;
  weekly_alerts: boolean;
  consultant_id?: string | null;
  extra_recipients?: string[] | null;
}

export interface ConsultantRow {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
}

/** Phase 4: who owns which company, from company_consultants. */
export type Assignments = Map<string, Set<string>>;

export async function loadAssignments(supabase: any): Promise<Assignments> {
  const out: Assignments = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('company_consultants').select('company_search_id, consultant_id').order('company_search_id').order('consultant_id').range(from, from + PAGE - 1);
    if (error) throw new Error(`company_consultants read failed: ${error.message}`);
    for (const r of data || []) {
      if (!out.has(r.company_search_id)) out.set(r.company_search_id, new Set());
      out.get(r.company_search_id)!.add(r.consultant_id);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function loadConsultants(supabase: any): Promise<Map<string, ConsultantRow>> {
  const { data, error } = await supabase.from('consultants').select('id, name, email, active');
  if (error) throw new Error(`consultants read failed: ${error.message}`);
  return new Map((data || []).map((c: ConsultantRow) => [c.id, c]));
}

/**
 * Who an alert setting emails: the setting's own address when it has one
 * (a copy for someone else, as Craig's copies of Anja's alerts), else the
 * consultant's address, plus any extra recipients a manager added.
 */
export function recipientsFor(config: AlertConfig, consultants: Map<string, ConsultantRow>): string[] {
  const out: string[] = [];
  const add = (e: string | null | undefined) => {
    const v = fold(e);
    if (v && v.includes('@') && !out.includes(v)) out.push(v);
  };
  add(config.email);
  if (!config.email && config.consultant_id) add(consultants.get(config.consultant_id)?.email);
  for (const e of config.extra_recipients || []) add(e);
  return out;
}

/**
 * A setting whose consultant is switched off on the Consultants page is
 * skipped by every alert function (Phase 4 hotfix, item 4). By id when the
 * setting has one, by name for a legacy setting; an unknown consultant is
 * not "inactive".
 */
export function consultantInactive(config: Pick<AlertConfig, 'consultant_id' | 'consultant_filter'>, consultants: Map<string, ConsultantRow>): boolean {
  if (config.consultant_id) {
    const c = consultants.get(config.consultant_id);
    return !!c && c.active === false;
  }
  const name = fold(config.consultant_filter);
  if (!name) return false;
  const c = [...consultants.values()].find((x) => fold(x.name) === name);
  return !!c && c.active === false;
}

export interface CompanyRow {
  id: string;
  company_name: string;
  url: string;
  company_number: string | null;
  analysis_result: any;
}

export interface VacancyRow {
  id: string;
  company_search_id: string;
  vacancy_key: string;
  title: string;
  url: string | null;
  source: string;
  closing_date: string | null;
  start_text: string | null;
  raw?: Record<string, unknown> | null;
  first_seen: string;
  last_seen: string;
  status: string;
}

/**
 * The ATS feeds: sources that answer whether or not the company's own
 * website does. A degraded refresh run (the website could not be read)
 * still read them, so their roles are real and may be alerted. Careers-page
 * rows from such a run are not: a degraded run never closes a careers-page
 * role, and the same rule read the other way says it never announces one.
 */
export const BOARD_SOURCES: ReadonlySet<string> = new Set(['ashby', 'greenhouse', 'lever', 'workable']);

export interface RefreshRunForAlerts {
  started_at: string;
  finished_at: string | null;
  degraded: boolean;
  sources_ok?: string[] | null;
}

export interface RunEligibility {
  fresh: boolean;
  reason?: string;
  /** Set when the run was degraded: only vacancies from these boards may be alerted. */
  boardsOnly?: string[];
}

/**
 * Whether a company's latest refresh run may feed today's alert. Fresh and
 * clean: every open vacancy first seen today counts. Degraded but at least
 * one board answered: only that board's vacancies count. Otherwise skipped.
 */
export function runEligibility(run: RefreshRunForAlerts | undefined, cutoff: Date): RunEligibility {
  if (!run) return { fresh: false, reason: 'no refresh run in the last 2 days' };
  if (new Date(run.started_at) < cutoff) return { fresh: false, reason: `latest run ${run.started_at} is older than the snapshot` };
  if (!run.finished_at) return { fresh: false, reason: 'latest run has not finished' };
  if (run.degraded) {
    const boards = (run.sources_ok || []).filter((x) => BOARD_SOURCES.has(x));
    if (!boards.length) return { fresh: false, reason: 'latest run was degraded and no job board answered' };
    return { fresh: true, boardsOnly: boards };
  }
  return { fresh: true };
}

/** A vacancy row may be alerted under this eligibility: any source on a clean run, only the boards that answered on a degraded one. */
export function vacancyEligible(v: Pick<VacancyRow, 'source'>, e: RunEligibility): boolean {
  if (!e.fresh) return false;
  if (!e.boardsOnly) return true;
  return e.boardsOnly.includes(v.source);
}

export function fold(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

export function companyConsultants(row: CompanyRow): string[] {
  const c = row.analysis_result?.consultant;
  if (!c || typeof c !== 'string') return [];
  return c.split(',').map(fold).filter(Boolean);
}

/** Where the company is registered, for the card: the registered office locality. */
export function companyLocation(row: CompanyRow): string | null {
  return row.analysis_result?.companyRecord?.registeredOffice?.locality || null;
}

export function companyDisplayName(row: CompanyRow): string {
  return row.analysis_result?.companyRecord?.name || row.company_name;
}

/**
 * Is this company in the config's scope? The assignment wins; the legacy
 * consultant tag applies when the setting has no consultant id; with
 * neither the config covers every company (the caller logs that).
 */
export function companyInScope(row: CompanyRow, config: Pick<AlertConfig, 'consultant_filter' | 'consultant_id'>, assignments?: Assignments): boolean {
  if (config.consultant_id && assignments) return assignments.get(row.id)?.has(config.consultant_id) ?? false;
  const consultant = fold(config.consultant_filter);
  if (consultant) return companyConsultants(row).includes(consultant);
  return true;
}

export function scopeDescription(config: Pick<AlertConfig, 'consultant_filter' | 'consultant_id'>): string {
  if (config.consultant_id) return `consultant ${config.consultant_filter?.trim() || config.consultant_id} (by assignment)`;
  if (fold(config.consultant_filter)) return `consultant "${config.consultant_filter!.trim()}"`;
  return 'all companies (no consultant filter)';
}

export async function buildCardItem(supabaseUrl: string, recipientEmail: string, v: VacancyRow, company: CompanyRow): Promise<VacancyCardItem> {
  const secret = feedbackSecret();
  return {
    title: v.title,
    url: v.url || undefined,
    sourceLabel: SOURCE_LABELS[v.source as keyof typeof SOURCE_LABELS] || v.source,
    companyName: companyDisplayName(company),
    companyWebsite: company.url,
    location: companyLocation(company) || undefined,
    department: typeof v.raw?.department === 'string' ? v.raw.department : undefined,
    jobLocation: typeof v.raw?.location === 'string' ? v.raw.location : undefined,
    workplaceType: typeof v.raw?.workplaceType === 'string' ? v.raw.workplaceType : undefined,
    postedDate: typeof v.raw?.datePosted === 'string' ? formatIsoDateUk(v.raw.datePosted) : undefined,
    closingDate: v.closing_date ? formatIsoDateUk(v.closing_date) : undefined,
    feedbackWrongCompanyUrl: await feedbackUrl(supabaseUrl, secret, 'wrong_company', v.id, recipientEmail),
    feedbackClosedUrl: await feedbackUrl(supabaseUrl, secret, 'closed', v.id, recipientEmail),
  };
}

export interface SendArgs {
  templateName: string;
  recipientEmail: string;
  idempotencyKey: string;
  templateData: Record<string, unknown>;
  dryRun: boolean;
  /**
   * With dryRun: still call send-transactional-email, asking it to render
   * only. Nothing is queued or sent, the HTML comes back, and the
   * function-to-function hop (the bearer the callee checks) is exercised
   * from the calling function, as the 10 September incident showed it must be.
   */
  render?: boolean;
}

export interface SendOutcome {
  status: 'sent' | 'dry_run' | 'rendered' | 'failed' | 'suppressed';
  error?: string;
  /** The queued message's id, so a delivery can be tied to it. */
  messageId?: string;
  /** The rendered HTML, on a render-only dry run. */
  html?: string;
  subject?: string;
}

/** The alert_deliveries.note that ties a delivery to its queued message. */
export function deliveryNote(messageId: string | undefined): string | null {
  return messageId ? `message:${messageId}` : null;
}

/** Enqueue through send-transactional-email, or just log when dryRun. */
export async function sendAlertEmail(supabase: any, args: SendArgs): Promise<SendOutcome> {
  if (args.dryRun && !args.render) {
    console.log(`[dryRun] would send ${args.templateName} to ${args.recipientEmail} (${args.idempotencyKey})`);
    return { status: 'dry_run' };
  }
  // Send the service key as the bearer explicitly: functions-js 2.116+ no
  // longer sets Authorization from the client key, and the callee checks it.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const { data, error } = await supabase.functions.invoke('send-transactional-email', {
    headers: serviceKey ? { Authorization: `Bearer ${serviceKey}` } : undefined,
    body: {
      templateName: args.templateName,
      recipientEmail: args.recipientEmail,
      idempotencyKey: args.idempotencyKey,
      templateData: args.templateData,
      dryRun: args.dryRun === true,
    },
  });
  if (error) return { status: 'failed', error: error.message || String(error) };
  if (args.dryRun) return { status: 'rendered', html: typeof data?.html === 'string' ? data.html : undefined, subject: typeof data?.subject === 'string' ? data.subject : undefined };
  if (data && data.success === false && data.reason === 'email_suppressed') return { status: 'suppressed' };
  return { status: 'sent', messageId: typeof data?.messageId === 'string' ? data.messageId : undefined };
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function longDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Europe/London' });
}
