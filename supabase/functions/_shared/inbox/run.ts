// The inbox pass (22 September 2026): for every connected mailbox, read
// what arrived since the last read, keep the messages from people the site
// knows (match.ts), log each as a replied outcome on its company (which
// stops an active follow-up run), draft an answer (draft-reply.ts) and
// store the lot in inbox_replies. The watermark moves to the newest
// message read, so a message is never read twice; a mailbox whose refresh
// token is dead is marked needs_reconnect and left for the person.

import { mergedContactsFor } from '../contacts/edits.ts';
import { stopSequence } from '../follow-ups/store.ts';
import { logAiUsage } from '../copy/usage.ts';
import { GraphError, listInboxSince, type MsConfig, refreshTokens, type GraphMessage } from './graph.ts';
import { buildIndex, matchSender, normaliseHost, stripQuotedThread, type KnownCompany, type KnownContact, type KnownSequence, type ReplyMatch } from './match.ts';
import { generateReplyDraft, type ReplyDraftResult } from './draft-reply.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const DEFAULT_LOOKBACK_DAYS = 3;
/** The reader is idle until an email has gone to a contact in this many days (23 September 2026; Craig: "no need for it to be checking that much at the moment"). */
export const IDLE_AFTER_DAYS = 60;

/** True when any contact has been emailed (an `emailed` outcome) in the last IDLE_AFTER_DAYS: something to match replies against. */
export async function hasRecentOutreach(supabase: Supabase, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - IDLE_AFTER_DAYS * 86_400_000).toISOString();
  const { count, error } = await supabase.from('outcomes').select('id', { count: 'exact', head: true }).eq('kind', 'emailed').gte('created_at', since);
  if (error) throw new Error(`outcomes read failed: ${error.message}`);
  return (count ?? 0) > 0;
}
const MAX_MESSAGES = 50;
const MAX_DRAFTS_PER_RUN = 8;

export interface ConnectionRow {
  id: string;
  profile_id: string;
  mailbox: string;
  display_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  status: string;
  watermark: string | null;
}

export interface InboxRunDeps {
  refreshTokens: (cfg: MsConfig, refreshToken: string) => Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string; scope: string | null }>;
  listInboxSince: (accessToken: string, since: string, top?: number) => Promise<GraphMessage[]>;
  draftReply: typeof generateReplyDraft;
}

export const liveInboxDeps: InboxRunDeps = { refreshTokens, listInboxSince, draftReply: generateReplyDraft };

export interface ConnectionResult {
  connectionId: string;
  mailbox: string;
  read: number;
  matched: number;
  drafted: number;
  stopped: number;
  status: string;
  error: string | null;
  watermark: string | null;
}

/** Everything the matcher needs, from the database. */
export async function loadIndex(supabase: Supabase) {
  const [{ data: companies }, { data: seqs }] = await Promise.all([
    supabase.from('company_searches').select('id, company_name, url, analysis_result').limit(2000),
    supabase.from('follow_up_sequences').select('id, company_search_id, contact_email, contact_name').eq('status', 'active'),
  ]);
  const known: KnownCompany[] = [];
  const contacts: KnownContact[] = [];
  for (const c of companies || []) {
    const name = c.analysis_result?.companyRecord?.name || c.company_name;
    known.push({ id: c.id, name, host: normaliseHost(c.url) });
    const merged = await mergedContactsFor<Record<string, unknown>>(supabase, c.id, Array.isArray(c.analysis_result?.decisionMakers) ? c.analysis_result.decisionMakers : []);
    for (const d of merged) if (d.email) contacts.push({ companyId: c.id, companyName: name, email: String(d.email).toLowerCase(), name: d.name ? String(d.name) : null });
  }
  const sequences: KnownSequence[] = (seqs || []).map((s: any) => ({ id: s.id, companyId: s.company_search_id, contactEmail: String(s.contact_email).toLowerCase(), contactName: String(s.contact_name) }));
  const nameById = new Map(known.map((k) => [k.id, k.name]));
  return { index: buildIndex({ sequences, contacts, companies: known }), nameById, hostById: new Map(known.map((k) => [k.id, k.host])) };
}

async function accessTokenFor(supabase: Supabase, cfg: MsConfig, conn: ConnectionRow, deps: InboxRunDeps, now: Date): Promise<string> {
  const fresh = conn.access_token && conn.token_expires_at && Date.parse(conn.token_expires_at) > now.getTime() + 120_000;
  if (fresh) return conn.access_token as string;
  if (!conn.refresh_token) throw new GraphError('no refresh token; connect Outlook again', 0, true);
  const t = await deps.refreshTokens(cfg, conn.refresh_token);
  await supabase.from('mail_connections').update({ access_token: t.accessToken, refresh_token: t.refreshToken || conn.refresh_token, token_expires_at: t.expiresAt, scope: t.scope }).eq('id', conn.id);
  return t.accessToken;
}

async function sentBefore(supabase: Supabase, companyId: string, email: string): Promise<Array<{ subject: string | null; body: string | null; sentAt: string | null }>> {
  const out: Array<{ subject: string | null; body: string | null; sentAt: string | null }> = [];
  const { data: steps } = await supabase.from('follow_up_steps').select('subject, body, completed_at, follow_up_sequences!inner(company_search_id, contact_email)').eq('status', 'sent').eq('follow_up_sequences.company_search_id', companyId).eq('follow_up_sequences.contact_email', email).order('completed_at', { ascending: false }).limit(3);
  for (const s of steps || []) out.push({ subject: s.subject, body: s.body, sentAt: s.completed_at });
  return out;
}

/** One mailbox. Never throws; the result carries the error. */
export async function readConnection(supabase: Supabase, cfg: MsConfig, conn: ConnectionRow, ctx: Awaited<ReturnType<typeof loadIndex>>, consultant: { displayName: string; firstName: string }, deps: InboxRunDeps, now: Date): Promise<ConnectionResult> {
  const result: ConnectionResult = { connectionId: conn.id, mailbox: conn.mailbox, read: 0, matched: 0, drafted: 0, stopped: 0, status: conn.status, error: null, watermark: conn.watermark };
  try {
    const token = await accessTokenFor(supabase, cfg, conn, deps, now);
    const since = conn.watermark || new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86_400_000).toISOString();
    const messages = await deps.listInboxSince(token, since, MAX_MESSAGES);
    result.read = messages.length;
    let newest = conn.watermark;
    let drafts = 0;
    for (const m of messages) {
      if (!newest || m.receivedAt > newest) newest = m.receivedAt;
      const match: ReplyMatch | null = matchSender(ctx.index, m.fromEmail, m.fromName);
      if (!match) continue;
      const companyName = ctx.nameById.get(match.companyId) || match.companyName;
      const messageId = m.internetMessageId || m.id;
      const { data: existing } = await supabase.from('inbox_replies').select('id').eq('connection_id', conn.id).eq('message_id', messageId).maybeSingle();
      if (existing) continue;
      result.matched++;
      const replyText = stripQuotedThread(m.bodyText || m.preview || '');
      // The outcome: a reply on the company, which is what stops a follow-up run.
      const { data: outcome } = await supabase.from('outcomes').insert({
        company_search_id: match.companyId, consultant_id: null, created_by: conn.profile_id, contact_name: match.contactName, kind: 'replied',
        note: `Replied by email${m.subject ? `: ${m.subject}` : ''}${replyText ? ` | ${replyText.slice(0, 300)}` : ''}`,
        external_refs: { via: 'outlook', message_id: messageId, sequence_id: match.sequenceId },
      }).select('id').maybeSingle();
      if (match.sequenceId) {
        await stopSequence(supabase, match.sequenceId, 'they replied', now);
        result.stopped++;
      }
      const row: Record<string, unknown> = {
        connection_id: conn.id, message_id: messageId, graph_id: m.id, conversation_id: m.conversationId, from_email: m.fromEmail, from_name: m.fromName, subject: m.subject,
        received_at: m.receivedAt, preview: m.preview, body_text: replyText || m.bodyText, company_search_id: match.companyId, contact_name: match.contactName, match_note: match.note,
        sequence_id: match.sequenceId, outcome_id: outcome?.id ?? null,
      };
      if (drafts < MAX_DRAFTS_PER_RUN) {
        drafts++;
        try {
          const host = ctx.hostById.get(match.companyId);
          const gen: ReplyDraftResult = await deps.draftReply({
            companyName, companyLine: host ? `Website ${host}.` : '', contactName: match.contactName, consultant,
            sentBefore: m.fromEmail ? await sentBefore(supabase, match.companyId, m.fromEmail) : [],
            reply: { subject: m.subject, text: replyText || m.preview || '', receivedAt: m.receivedAt }, today: now,
          }, match.companyId);
          await logAiUsage(supabase, gen.usage);
          row.draft_subject = gen.draft.subject; row.draft_body = gen.draft.body; row.draft_flags = gen.flags; row.drafted_at = now.toISOString(); row.match_note = `${match.note}; read: ${gen.draft.read}`;
          result.drafted++;
        } catch (e) {
          const usage = (e as { usage?: unknown }).usage;
          if (usage) await logAiUsage(supabase, usage as Parameters<typeof logAiUsage>[1]);
          row.draft_error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        }
      }
      const { error: insErr } = await supabase.from('inbox_replies').insert(row);
      if (insErr) result.error = `inbox_replies insert failed: ${insErr.message}`;
    }
    result.watermark = newest;
    result.status = 'connected';
    await supabase.from('mail_connections').update({ watermark: newest, last_checked_at: now.toISOString(), last_error: result.error, status: 'connected' }).eq('id', conn.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reconnect = e instanceof GraphError && e.reconnect;
    result.error = msg;
    result.status = reconnect ? 'needs_reconnect' : conn.status;
    await supabase.from('mail_connections').update({ last_checked_at: now.toISOString(), last_error: msg.slice(0, 300), ...(reconnect ? { status: 'needs_reconnect' } : {}) }).eq('id', conn.id);
  }
  return result;
}

/** Every connected mailbox, or one. */
export async function readInboxes(supabase: Supabase, cfg: MsConfig, options: { now: Date; connectionId?: string | null; deps?: InboxRunDeps }): Promise<ConnectionResult[]> {
  const deps = options.deps ?? liveInboxDeps;
  let q = supabase.from('mail_connections').select('id, profile_id, mailbox, display_name, access_token, refresh_token, token_expires_at, status, watermark').neq('status', 'disconnected');
  if (options.connectionId) q = q.eq('id', options.connectionId);
  const { data: conns, error } = await q;
  if (error) throw new Error(`mail_connections read failed: ${error.message}`);
  if (!conns?.length) return [];
  const ctx = await loadIndex(supabase);
  const out: ConnectionResult[] = [];
  for (const conn of conns as ConnectionRow[]) {
    const { data: profile } = await supabase.from('profiles').select('display_name, email').eq('id', conn.profile_id).maybeSingle();
    const displayName = String(profile?.display_name || conn.display_name || (profile?.email ? String(profile.email).split('@')[0] : 'Craig')).trim();
    out.push(await readConnection(supabase, cfg, conn, ctx, { displayName, firstName: displayName.split(/\s+/)[0] || displayName }, deps, options.now));
  }
  return out;
}
