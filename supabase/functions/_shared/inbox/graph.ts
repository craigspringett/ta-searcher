// Microsoft Graph for one mailbox (22 September 2026): the sign-in URL,
// the code exchange, the refresh, and the inbox read. The app is a
// single-tenant registration in Big Fish's Entra directory (MS_CLIENT_ID,
// MS_TENANT_ID as plain secrets, MS_CLIENT_SECRET set by Craig); the
// delegated scopes are Mail.Read, User.Read and offline_access. Every
// call is bounded and never throws past its own error type.

import { fetchWithTimeout } from '../fetch.ts';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
export const SCOPES = 'offline_access User.Read Mail.Read';
const FETCH_MS = 20_000;

export interface MsConfig { clientId: string; tenantId: string; clientSecret: string | null; redirectUri: string }

export function msConfig(supabaseUrl: string): MsConfig | null {
  const clientId = Deno.env.get('MS_CLIENT_ID') || '';
  const tenantId = Deno.env.get('MS_TENANT_ID') || '';
  if (!clientId || !tenantId) return null;
  return { clientId, tenantId, clientSecret: Deno.env.get('MS_CLIENT_SECRET') || null, redirectUri: `${supabaseUrl}/functions/v1/ms-oauth-callback` };
}

export function authorizeUrl(cfg: MsConfig, state: string): string {
  const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: cfg.redirectUri, response_mode: 'query', scope: SCOPES, state, prompt: 'select_account' });
  return `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize?${q.toString()}`;
}

export class GraphError extends Error {
  status: number;
  /** True when the refresh token is dead and the person must connect again. */
  reconnect: boolean;
  constructor(msg: string, status: number, reconnect = false) { super(msg); this.name = 'GraphError'; this.status = status; this.reconnect = reconnect; }
}

export interface Tokens { accessToken: string; refreshToken: string | null; expiresAt: string; scope: string | null }

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const doFetch: FetchLike = (u, i) => fetchWithTimeout(u, FETCH_MS, i);

async function tokenRequest(cfg: MsConfig, params: Record<string, string>, fetcher: FetchLike): Promise<Tokens> {
  if (!cfg.clientSecret) throw new GraphError('MS_CLIENT_SECRET is not set on the project', 0);
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: SCOPES, ...params });
  const res = await fetcher(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(json?.error || '');
    const desc = String(json?.error_description || '').split('\n')[0].slice(0, 200);
    throw new GraphError(`${code || `HTTP ${res.status}`}${desc ? `: ${desc}` : ''}`, res.status, /invalid_grant|interaction_required|consent_required/.test(code));
  }
  const expiresIn = Number(json.expires_in) || 3600;
  return { accessToken: String(json.access_token), refreshToken: json.refresh_token ? String(json.refresh_token) : null, expiresAt: new Date(Date.now() + (expiresIn - 60) * 1000).toISOString(), scope: json.scope ? String(json.scope) : null };
}

export function exchangeCode(cfg: MsConfig, code: string, fetcher: FetchLike = doFetch): Promise<Tokens> {
  return tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri }, fetcher);
}

export function refreshTokens(cfg: MsConfig, refreshToken: string, fetcher: FetchLike = doFetch): Promise<Tokens> {
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetcher);
}

async function graphGet(accessToken: string, path: string, fetcher: FetchLike, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetcher(path.startsWith('https://') ? path : `${GRAPH}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(json?.error?.code || '');
    throw new GraphError(`Graph ${res.status}${code ? ` ${code}` : ''}: ${String(json?.error?.message || '').slice(0, 200)}`, res.status, res.status === 401);
  }
  return json;
}

export interface Me { mail: string; displayName: string | null }

export async function me(accessToken: string, fetcher: FetchLike = doFetch): Promise<Me> {
  const j = await graphGet(accessToken, '/me?$select=mail,userPrincipalName,displayName', fetcher);
  return { mail: String(j.mail || j.userPrincipalName || '').toLowerCase(), displayName: j.displayName ? String(j.displayName) : null };
}

export interface GraphMessage {
  id: string;
  internetMessageId: string | null;
  conversationId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  receivedAt: string;
  preview: string | null;
  bodyText: string | null;
  isDraft: boolean;
}

/** The message shape as Graph gives it, reduced; the body comes as text (the Prefer header). */
export function parseMessage(m: any): GraphMessage | null {
  const id = m?.id ? String(m.id) : null;
  const receivedAt = m?.receivedDateTime ? String(m.receivedDateTime) : null;
  if (!id || !receivedAt) return null;
  const from = m?.from?.emailAddress || m?.sender?.emailAddress || null;
  const content = m?.body?.content ? String(m.body.content) : null;
  const text = content ? (String(m?.body?.contentType || '').toLowerCase() === 'html' ? htmlToPlain(content) : content) : null;
  return {
    id,
    internetMessageId: m?.internetMessageId ? String(m.internetMessageId) : null,
    conversationId: m?.conversationId ? String(m.conversationId) : null,
    fromEmail: from?.address ? String(from.address).toLowerCase() : null,
    fromName: from?.name ? String(from.name) : null,
    subject: m?.subject ? String(m.subject) : null,
    receivedAt,
    preview: m?.bodyPreview ? String(m.bodyPreview).slice(0, 500) : null,
    bodyText: text ? text.slice(0, 6000) : null,
    isDraft: m?.isDraft === true,
  };
}

function htmlToPlain(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/** The inbox messages received after `since` (ISO), oldest first, at most `top`. */
export async function listInboxSince(accessToken: string, since: string, top = 50, fetcher: FetchLike = doFetch): Promise<GraphMessage[]> {
  const q = new URLSearchParams({ '$filter': `receivedDateTime gt ${since}`, '$orderby': 'receivedDateTime asc', '$top': String(top), '$select': 'id,internetMessageId,conversationId,from,sender,subject,receivedDateTime,bodyPreview,body,isDraft' });
  const j = await graphGet(accessToken, `/me/mailFolders/inbox/messages?${q.toString()}`, fetcher, { Prefer: 'outlook.body-content-type="text"' });
  return (Array.isArray(j?.value) ? j.value : []).map(parseMessage).filter((m: GraphMessage | null): m is GraphMessage => !!m && !m.isDraft);
}
