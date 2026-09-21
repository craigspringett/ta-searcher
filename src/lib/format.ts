// Small formatting and error helpers shared by the pages.

export const formatIsoDateUk = (iso?: string | null): string => {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// Pulls the real error body out of a failed supabase.functions.invoke call.
export const describeFunctionError = async (error: unknown): Promise<string> => {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      try {
        const text = await ctx.clone().text();
        if (text) return text.slice(0, 300);
      } catch { /* ignore */ }
    }
  }
  return error instanceof Error ? error.message : 'Failed to analyse the URL';
};

