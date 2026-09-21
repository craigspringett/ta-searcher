// app_settings.prospecting: the auto-promote threshold, the weekly cap and
// the register walk's watermarks. The row is seeded by supabase/seed.sql and
// the discover pass writes the watermarks back (service role); the Prospects
// page edits the two numbers.
import type { ProspectingSettings } from './types.ts';

export const SETTINGS_KEY = 'prospecting';
export const DEFAULT_AUTO_PROMOTE_SCORE = 60;
export const DEFAULT_WEEKLY_PROMOTE_CAP = 15;

// deno-lint-ignore no-explicit-any
type Supabase = any;

function intOr(v: unknown, fallback: number, min = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

/** The settings from a stored value, with the defaults for what is missing. */
export function settingsFromValue(value: unknown): ProspectingSettings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const raw = v.watermarks && typeof v.watermarks === 'object' ? v.watermarks as Record<string, unknown> : {};
  const watermarks: Record<string, number> = {};
  for (const [k, n] of Object.entries(raw)) {
    const i = Number(n);
    if (Number.isFinite(i) && i >= 0) watermarks[k] = Math.floor(i);
  }
  return {
    autoPromoteScore: intOr(v.autoPromoteScore, DEFAULT_AUTO_PROMOTE_SCORE),
    weeklyPromoteCap: intOr(v.weeklyPromoteCap, DEFAULT_WEEKLY_PROMOTE_CAP),
    watermarks,
    registerCursor: intOr(v.registerCursor, 0),
  };
}

export async function loadSettings(supabase: Supabase): Promise<ProspectingSettings> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
  if (error) throw new Error(`app_settings read failed: ${error.message}`);
  return settingsFromValue(data?.value);
}

/** Write the walk's state back without touching the two numbers the page edits (they are re-read first). */
export async function saveWalkState(supabase: Supabase, state: { watermarks: Record<string, number>; registerCursor: number }): Promise<void> {
  const current = await loadSettings(supabase);
  const value = { ...current, watermarks: state.watermarks, registerCursor: state.registerCursor };
  const { error } = await supabase.from('app_settings').upsert({ key: SETTINGS_KEY, value }, { onConflict: 'key' });
  if (error) throw new Error(`app_settings write failed: ${error.message}`);
}
