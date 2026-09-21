// One JSON read of a public ATS feed, never throwing. The four feeds (Ashby,
// Greenhouse, Lever, Workable) answer JSON without a key, so a plain fetch
// with a timeout is enough; fetchPage's browser ladder is for HTML sites that
// drop the edge runtime, not for these APIs. Tests stub globalThis.fetch.
import { DEFAULT_USER_AGENT } from '../fetch.ts';
import { toIsoDate } from '../dates.ts';

export const FEED_MS = 20000;

export interface FeedRead<T> {
  ok: boolean;
  /** HTTP status, 0 when nothing answered. */
  status: number;
  data: T | null;
  /** Why the read is not ok, or a remark about it. */
  note: string | null;
  ms: number;
}

export async function fetchJsonFeed<T>(url: string, ms: number = FEED_MS): Promise<FeedRead<T>> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${ms}ms`)), ms);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'application/json' }, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      const tail = text.replace(/\s+/g, ' ').trim().slice(0, 120);
      return { ok: false, status: res.status, data: null, note: `HTTP ${res.status}${tail ? ` ${tail}` : ''}`, ms: Date.now() - started };
    }
    try {
      return { ok: true, status: res.status, data: JSON.parse(text) as T, note: null, ms: Date.now() - started };
    } catch {
      return { ok: false, status: res.status, data: null, note: 'the feed did not answer JSON', ms: Date.now() - started };
    }
  } catch (e) {
    return { ok: false, status: 0, data: null, note: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** An ISO date (YYYY-MM-DD) from an ISO datetime, a date string or a millisecond epoch; null when unreadable. */
export function isoDateOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  let d: Date;
  if (typeof value === 'number') d = new Date(value);
  else if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{10,13}$/.test(s)) d = new Date(Number(s.length === 10 ? Number(s) * 1000 : s));
    else d = new Date(s);
  } else return null;
  if (Number.isNaN(d.getTime())) return null;
  return toIsoDate(d);
}

/** The feed's workplace words, mapped to 'remote' | 'hybrid' | 'onsite' | null. */
export function workplaceTypeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (/^(?:remote|fully remote|telecommute|work from home|wfh)$/.test(v)) return 'remote';
  if (/^hybrid$/.test(v)) return 'hybrid';
  if (/^(?:on[- ]?site|in[- ]?office|office)$/.test(v)) return 'onsite';
  return null;
}

/** Tidy a feed's employment type: "FullTime" -> "Full-time", "Employee - Permanent" as is. */
export function employmentTypeOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const map: Record<string, string> = { fulltime: 'Full-time', full_time: 'Full-time', 'full-time': 'Full-time', parttime: 'Part-time', part_time: 'Part-time', 'part-time': 'Part-time', contract: 'Contract', contractor: 'Contract', temporary: 'Temporary', intern: 'Internship', internship: 'Internship' };
  return map[v.toLowerCase()] ?? v;
}

/** The text of a location, from a string or an object with city, region, country parts. */
export function locationTextOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name.trim()) return o.name.trim();
    const parts = [o.city, o.region, o.country].filter((p): p is string => typeof p === 'string' && !!p.trim()).map((p) => p.trim());
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}
