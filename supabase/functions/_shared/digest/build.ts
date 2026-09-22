// The weekly raises digest (22 September 2026, Craig's list): every raise
// the radar saw in the last week, in the sectors and at the stages Craig
// chose, grouped by sector, one email on Monday morning. Pure; the
// send-raises-digest function loads the rows and sends.

import { prospectSector, prospectStage, SECTORS, STAGES, type Sector, type Stage } from '../prospecting/sector.ts';

export const DIGEST_SETTINGS_KEY = 'raises_digest';
export const DIGEST_DAYS = 7;
export const DIGEST_MAX_ITEMS = 40;

export interface DigestSettings {
  enabled: boolean;
  /** Empty means every sector. */
  sectors: Sector[];
  /** Empty means every stage except Unknown. */
  stages: Stage[];
  /** Empty means every active consultant. */
  recipients: string[];
}

export function digestSettingsFromValue(value: unknown): DigestSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const sectors = Array.isArray(v.sectors) ? v.sectors.filter((s): s is Sector => (SECTORS as readonly string[]).includes(String(s))) : [];
  const stages = Array.isArray(v.stages) ? v.stages.filter((s): s is Stage => (STAGES as readonly string[]).includes(String(s))) : [];
  const recipients = Array.isArray(v.recipients) ? v.recipients.map((r) => String(r).trim().toLowerCase()).filter((r) => r.includes('@')) : [];
  return { enabled: v.enabled !== false, sectors, stages, recipients };
}

/** A prospects row as the digest reads it. */
export interface DigestProspectRow {
  id: string;
  name: string;
  website: string | null;
  status: string;
  sources: Array<{ source?: string; url?: string | null; title?: string | null; note?: string | null; at?: string | null }>;
  raise: { amountText?: string | null; amountGbp?: number | null; round?: string | null; date?: string | null; url?: string | null } | null;
  register: { sector?: string | null; incorporationDate?: string | null; locality?: string | null; capitalFilings?: Array<{ type?: string | null; date?: string | null }> } | null;
  talent_postings: Array<{ title: string }>;
  prospect_score: number | null;
  first_seen_at: string;
  promoted_company_id: string | null;
}

export interface DigestItem {
  name: string;
  sector: Sector;
  stage: Stage;
  /** "£2m seed" or "a raise". */
  raiseLine: string;
  /** ISO date of the story, else when the radar saw it. */
  date: string;
  headline: string | null;
  storyUrl: string | null;
  website: string | null;
  locality: string | null;
  score: number | null;
  /** The company page when the radar added it, else the Prospects page. */
  appUrl: string;
  tracked: boolean;
}

export interface DigestSection {
  sector: Sector;
  items: DigestItem[];
}

export interface Digest {
  weekEnding: string;
  sections: DigestSection[];
  count: number;
  /** Raises seen but outside the chosen sectors or stages. */
  filteredOut: number;
  subject: string;
}

function raiseLine(r: DigestProspectRow['raise']): string {
  if (!r) return 'a raise';
  const bits = [r.amountText, r.round].filter((x): x is string => !!x && x.trim().length > 0);
  return bits.length ? bits.join(' ') : 'a raise';
}

function storyOf(p: DigestProspectRow): { headline: string | null; url: string | null } {
  const news = (p.sources || []).filter((s) => s.source === 'funding_news' && s.url);
  if (!news.length) return { headline: null, url: p.raise?.url ?? null };
  const latest = [...news].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  return { headline: latest.title ?? null, url: latest.url ?? null };
}

/** The prospects with a raise dated (or first seen) within the last DIGEST_DAYS, that the consultant has not dismissed. */
export function inTheWeek(p: DigestProspectRow, now: Date): boolean {
  if (!p.raise) return false;
  if (p.status === 'dismissed' || p.status === 'unsuitable') return false;
  const since = now.getTime() - DIGEST_DAYS * 86_400_000;
  const dated = p.raise.date ? Date.parse(p.raise.date) : NaN;
  if (!Number.isNaN(dated)) return dated >= since && dated <= now.getTime() + 86_400_000;
  return Date.parse(p.first_seen_at) >= since;
}

export function buildDigest(rows: DigestProspectRow[], settings: DigestSettings, appUrl: string, now: Date): Digest {
  const weekEnding = now.toISOString().slice(0, 10);
  const wantedStages = settings.stages.length ? new Set<Stage>(settings.stages) : new Set<Stage>(STAGES.filter((s) => s !== 'Unknown'));
  const wantedSectors = settings.sectors.length ? new Set<Sector>(settings.sectors) : null;
  const items: DigestItem[] = [];
  let filteredOut = 0;
  for (const p of rows.filter((r) => inTheWeek(r, now))) {
    const sector = prospectSector({ sources: p.sources || [], talentPostings: p.talent_postings || [], website: p.website, register: p.register, name: p.name });
    const stage = prospectStage({ raise: p.raise, register: p.register }, now);
    if ((wantedSectors && !wantedSectors.has(sector)) || !wantedStages.has(stage)) { filteredOut++; continue; }
    const story = storyOf(p);
    items.push({
      name: p.name,
      sector,
      stage,
      raiseLine: raiseLine(p.raise),
      date: p.raise?.date || p.first_seen_at.slice(0, 10),
      headline: story.headline,
      storyUrl: story.url,
      website: p.website,
      locality: p.register?.locality ?? null,
      score: p.prospect_score,
      appUrl: p.promoted_company_id ? `${appUrl}/companies/${p.promoted_company_id}` : `${appUrl}/prospects`,
      tracked: !!p.promoted_company_id,
    });
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  const kept = items.slice(0, DIGEST_MAX_ITEMS);
  const bySector = new Map<Sector, DigestItem[]>();
  for (const it of kept) (bySector.get(it.sector) ?? bySector.set(it.sector, []).get(it.sector)!).push(it);
  const sections: DigestSection[] = SECTORS.filter((s) => bySector.has(s)).map((s) => ({ sector: s, items: bySector.get(s)! }));
  const count = kept.length;
  const subject = count === 0 ? `No new raises in your sectors this week` : `${count} new ${count === 1 ? 'raise' : 'raises'} in your sectors this week`;
  return { weekEnding, sections, count, filteredOut: filteredOut + (items.length - kept.length), subject };
}
