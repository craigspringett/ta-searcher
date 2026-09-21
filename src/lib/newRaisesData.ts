import { supabase } from "@/integrations/supabase/client";
import { NEW_RAISE_DAYS, type NewRaise } from "@/lib/newRaises";

/**
 * The raise stories of the last fortnight from funding_news, newest first,
 * with the matched company's own name from a second read of
 * company_searches. The window is a day wider than the card's so a story
 * published late on the boundary day is still there for groupRaises.
 */
export async function loadNewRaises(today = new Date()): Promise<NewRaise[]> {
  const since = new Date(today.getTime() - (NEW_RAISE_DAYS + 1) * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("funding_news")
    .select("id, source, title, url, publisher, published_at, first_seen_at, company_name, amount_text, amount_gbp, round, matched_company_search_id")
    .or(`published_at.gte.${since},first_seen_at.gte.${since}`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = data || [];
  const ids = Array.from(new Set(rows.map((r) => r.matched_company_search_id).filter((x): x is string => !!x)));
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: companies, error: cErr } = await supabase.from("company_searches").select("id, company_name, url").in("id", ids);
    if (cErr) throw new Error(cErr.message);
    for (const c of companies || []) names.set(c.id, (c.company_name || "").trim() || c.url);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    publisher: r.publisher,
    source: r.source,
    publishedAt: r.published_at,
    firstSeenAt: r.first_seen_at,
    companyName: r.company_name,
    amountText: r.amount_text,
    amountGbp: r.amount_gbp === null ? null : Number(r.amount_gbp),
    round: r.round,
    matchedCompanyId: r.matched_company_search_id,
    matchedCompanyName: r.matched_company_search_id ? names.get(r.matched_company_search_id) ?? null : null,
  }));
}
