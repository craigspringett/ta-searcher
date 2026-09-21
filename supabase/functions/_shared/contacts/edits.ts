// Reading company_contact_edits and laying them over a company's stored
// contacts (Contact edits, 18 September 2026). The rule itself is
// ../contacts.ts (the same file as src/lib/contacts.ts); this is the
// database side of it for the edge functions: the outreach and follow-up
// checks, the copy writer and the Friday brief.

import { type ContactEditRow, type ContactLike, type MergedContact, mergeContacts } from '../contacts.ts';

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const CONTACT_EDIT_COLUMNS = 'id, company_search_id, contact_key, name, role, email, phone, note, action, edited_by, edited_by_name, created_at, updated_at';

/** The edit rows for these companies, grouped by company (every row: the merge picks the newest per person). */
export async function loadContactEdits(supabase: Supabase, companyIds: string[]): Promise<Map<string, ContactEditRow[]>> {
  const out = new Map<string, ContactEditRow[]>();
  const ids = Array.from(new Set(companyIds.filter(Boolean)));
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('company_contact_edits').select(CONTACT_EDIT_COLUMNS).in('company_search_id', ids.slice(i, i + 200)).order('created_at', { ascending: true }).limit(5000);
    if (error) throw new Error(`company_contact_edits: ${error.message}`);
    for (const row of (data || []) as Array<ContactEditRow & { company_search_id: string }>) {
      (out.get(row.company_search_id) ?? out.set(row.company_search_id, []).get(row.company_search_id)!).push(row);
    }
  }
  return out;
}

/** Every edit row there is, grouped by company, for a whole-list read such as the Friday brief. Paged, because a request returns at most a thousand rows. */
export async function loadAllContactEdits(supabase: Supabase): Promise<Map<string, ContactEditRow[]>> {
  const out = new Map<string, ContactEditRow[]>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from('company_contact_edits').select(CONTACT_EDIT_COLUMNS).order('created_at', { ascending: true }).order('id').range(from, from + page - 1);
    if (error) throw new Error(`company_contact_edits: ${error.message}`);
    const rows = (data || []) as Array<ContactEditRow & { company_search_id: string }>;
    for (const row of rows) (out.get(row.company_search_id) ?? out.set(row.company_search_id, []).get(row.company_search_id)!).push(row);
    if (rows.length < page) break;
  }
  return out;
}

/** One company's contacts as a consultant sees them: the stored list with its edits laid over. */
export async function mergedContactsFor<T extends ContactLike>(supabase: Supabase, companyId: string, decisionMakers: T[] | null | undefined): Promise<Array<MergedContact<T>>> {
  const edits = await loadContactEdits(supabase, [companyId]);
  return mergeContacts(decisionMakers, edits.get(companyId) || []);
}
