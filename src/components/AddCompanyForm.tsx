import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { companiesHouseUrl, companyStatusLabel } from "@/lib/analysis";
import { formatLongDate } from "@/lib/patch";

/** What company-lookup answers: {q} in, the register's hits out, and whether the key is set. */
export interface CompanySearchHit {
  companyNumber: string;
  name: string;
  status: string | null;
  incorporationDate: string | null;
  addressSnippet: string | null;
  postcode: string | null;
}

export interface AnalyseInput {
  url: string;
  companyNumber: string | null;
  companyName: string | null;
}

interface Props {
  /** A bulk refresh is running: nothing can be started. */
  disabled: boolean;
  analysing: boolean;
  /** The company on screen, when there is one: the form shows it and offers "New search". */
  current: { url: string; companyNumber: string | null; name: string } | null;
  onAnalyse: (input: AnalyseInput) => void;
  onNewSearch: () => void;
}

/** "12345678" from "12345678", "SC123456", " 1234567 " (numeric ones are zero-padded to eight); null when empty. */
export function normaliseCompanyNumber(s: string): string | null {
  const v = s.trim().toUpperCase().replace(/\s+/g, "");
  if (!v) return null;
  if (/^\d{1,8}$/.test(v)) return v.padStart(8, "0");
  return v;
}

/** "example.com" or "https://example.com" becomes "https://example.com"; anything else is left for the server to refuse. */
export function normaliseUrl(s: string): string {
  const v = s.trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * The add form: search Companies House by name through company-lookup, pick
 * the right company, type or confirm the website, analyse. Without the API
 * key the register search is off and a company is added by website address
 * alone.
 */
export function AddCompanyForm({ disabled, analysing, current, onAnalyse, onNewSearch }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CompanySearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<CompanySearchHit | null>(null);
  const [url, setUrl] = useState("");
  const [companyNumber, setCompanyNumber] = useState("");
  const [byUrl, setByUrl] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3 || byUrl || configured === false) { setHits([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke("company-lookup", { body: { q } });
      if (cancelled) return;
      setBusy(false);
      if (error) { console.error("company-lookup failed:", error.message); setHits([]); return; }
      const reply = (data || {}) as { results?: CompanySearchHit[]; configured?: boolean };
      if (reply.configured === false) { setConfigured(false); setHits([]); setByUrl(true); return; }
      setConfigured(true);
      setHits(reply.results || []);
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, byUrl, configured]);

  const choose = (hit: CompanySearchHit) => {
    setSelected(hit);
    setCompanyNumber(hit.companyNumber);
    setQuery(hit.name);
    setHits([]);
    setProblem(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const site = normaliseUrl(url);
    if (!site) { setProblem("The website address is needed: it is what the careers page and the feeds are read from."); return; }
    try { new URL(site); } catch { setProblem("That does not look like a website address. Try something like https://example.com."); return; }
    onAnalyse({ url: site, companyNumber: normaliseCompanyNumber(companyNumber), companyName: selected?.name || query.trim() || null });
  };

  const reset = () => {
    setQuery(""); setHits([]); setSelected(null); setUrl(""); setCompanyNumber(""); setProblem(null);
    onNewSearch();
  };

  const showFields = byUrl || !!selected;

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Add a company</h2>
        <p className="text-sm text-muted-foreground">Find the company on Companies House, confirm its website, and the analysis reads the site, the register, the careers feeds and the people.</p>
      </div>

      {current ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">{current.name}</span>
            <span className="block text-xs text-muted-foreground break-all">{current.url}{current.companyNumber ? ` · Companies House ${current.companyNumber}` : " · no company number"}</span>
          </p>
          <Button onClick={reset} className="w-full h-12 text-base font-semibold" disabled={analysing}>
            <Plus className="mr-2 h-5 w-5" aria-hidden="true" />New search
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {!byUrl && (
            <div>
              <label htmlFor="company-search" className="text-sm font-medium text-foreground block mb-2">Find the company on Companies House</label>
              <div className="relative">
                <Input
                  id="company-search"
                  type="search"
                  placeholder="e.g. Searchable"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
                  disabled={disabled}
                  className="h-12"
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={hits.length > 0}
                />
                {busy && <Loader2 className="absolute right-3 top-4 h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                {hits.length > 0 && (
                  <ul role="listbox" className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                    {hits.map((h) => (
                      <li key={h.companyNumber} role="option" aria-selected={false}>
                        <button type="button" className="w-full text-left px-3 py-2 hover:bg-muted focus:bg-muted focus:outline-none" onClick={() => choose(h)}>
                          <span className="block text-sm font-medium">{h.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {h.companyNumber}{h.status ? ` · ${companyStatusLabel(h.status)}` : ""}{h.incorporationDate ? ` · incorporated ${formatLongDate(h.incorporationDate)}` : ""}{h.addressSnippet ? ` · ${h.addressSnippet}` : h.postcode ? ` · ${h.postcode}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selected && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {selected.name}, <a href={companiesHouseUrl(selected.companyNumber)} target="_blank" rel="noreferrer" className="text-primary hover:underline">{selected.companyNumber}</a>{selected.status ? `, ${companyStatusLabel(selected.status).toLowerCase()}` : ""}{selected.incorporationDate ? `, incorporated ${formatLongDate(selected.incorporationDate)}` : ""}. The register has no website: type it below.
                </p>
              )}
              {query.trim().length >= 3 && !busy && hits.length === 0 && !selected && configured !== false && (
                <p className="mt-2 text-xs text-muted-foreground">No company of that name on the register. Try the registered name (often "Something Ltd"), or add it by website address.</p>
              )}
              <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => setByUrl(true)}>Add by website address instead</button>
            </div>
          )}

          {configured === false && (
            <p className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-foreground" role="note">Companies House key not set: add by website address. Register a free key at developer.company-information.service.gov.uk and set the COMPANIES_HOUSE_API_KEY secret to search the register.</p>
          )}

          <div className={showFields ? "" : "hidden"}>
            <label htmlFor="url" className="text-sm font-medium text-foreground block mb-2">Website</label>
            <Input id="url" type="text" inputMode="url" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} disabled={disabled} className="h-12" autoComplete="off" />
          </div>
          <div className={showFields ? "" : "hidden"}>
            <label htmlFor="company-number" className="text-sm font-medium text-foreground block mb-2">Companies House number{byUrl ? " (optional)" : ""}</label>
            <Input id="company-number" type="text" placeholder="e.g. 12345678" value={companyNumber} onChange={(e) => setCompanyNumber(e.target.value)} disabled={disabled} className="h-12" autoComplete="off" />
            {byUrl && configured !== false && <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => { setByUrl(false); setSelected(null); }}>Search Companies House instead</button>}
          </div>

          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}

          {showFields && (
            <Button type="submit" disabled={analysing || disabled} className="w-full h-12 text-base font-semibold">
              {analysing ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />Analysing…</> : disabled ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />Refreshing all…</> : "Analyse company"}
            </Button>
          )}
        </form>
      )}
    </Card>
  );
}
