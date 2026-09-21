// Per-call model usage, logged to ai_usage with an estimated cost so spend
// is visible on the monitoring page. Prices are USD per million tokens and
// are estimates; the invoice from each provider is the truth.

export interface UsageRecord {
  provider: 'anthropic' | 'gemini';
  model: string;
  purpose: 'evidence' | 'departures' | 'copy' | 'copy_retry' | 'follow_up' | 'follow_up_retry' | 'shortlist' | 'candidate_email' | 'role_parse' | 'other';
  companySearchId: string | null;
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
  durationMs?: number;
  ok?: boolean;
  error?: string | null;
  details?: Record<string, unknown>;
}

interface Price { input: number; output: number; cacheWrite: number; cacheRead: number }

const PRICES: Array<{ match: RegExp; price: Price }> = [
  { match: /^claude-opus-5/, price: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  { match: /^claude-opus-4/, price: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 } },
  { match: /^claude-sonnet-5/, price: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 } },
  { match: /^claude-sonnet-4/, price: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { match: /^claude-haiku/, price: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 } },
  // Gemini Flash list price at the time of writing; the free tier bills nothing.
  { match: /gemini.*flash/i, price: { input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.075 } },
  { match: /gemini/i, price: { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.31 } },
];

export function priceFor(model: string): Price {
  for (const p of PRICES) if (p.match.test(model)) return p.price;
  return { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
}

export function estimateCostUsd(u: Pick<UsageRecord, 'model' | 'inputTokens' | 'cachedInputTokens' | 'cacheWriteTokens' | 'outputTokens'>): number {
  const p = priceFor(u.model);
  const usd = (u.inputTokens * p.input + (u.cachedInputTokens || 0) * p.cacheRead + (u.cacheWriteTokens || 0) * p.cacheWrite + u.outputTokens * p.output) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

// deno-lint-ignore no-explicit-any
export async function logAiUsage(supabase: any, u: UsageRecord): Promise<void> {
  try {
    const { error } = await supabase.from('ai_usage').insert({
      provider: u.provider,
      model: u.model,
      purpose: u.purpose,
      company_search_id: u.companySearchId,
      input_tokens: u.inputTokens,
      cached_input_tokens: u.cachedInputTokens || 0,
      cache_write_tokens: u.cacheWriteTokens || 0,
      output_tokens: u.outputTokens,
      estimated_cost_usd: estimateCostUsd(u),
      duration_ms: u.durationMs ?? null,
      ok: u.ok ?? true,
      error: u.error ? String(u.error).slice(0, 500) : null,
      details: u.details ?? null,
    });
    if (error) console.error('ai_usage insert failed:', error.message);
  } catch (e) {
    console.error('ai_usage insert failed:', e instanceof Error ? e.message : e);
  }
}
