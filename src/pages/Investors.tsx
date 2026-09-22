import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { SourceNote } from "@/components/SourceNote";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BAND_CLASSES, scoreBand } from "@/lib/propensity";
import { STAGE_LABELS, stageOf } from "@/lib/pipeline";
import { filterInvestors } from "@/lib/investors";
import { loadInvestors } from "@/lib/investorsData";

const SOURCE = "Every fund named in a tracked company's analysis: the investors in its latest raise, from the company's own website and the funding news, and the investor facts the evidence pass found. A fund with two or more companies here is a portfolio to work as one: the same platform team, the same introduction. Names are merged across spellings (Bessemer and Bessemer Venture Partners are one line).";

export default function Investors() {
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["investors"], queryFn: loadInvestors, staleTime: 60_000 });
  const [query, setQuery] = useState("");
  const groups = useMemo(() => filterInvestors(data?.groups || [], query), [data, query]);
  const portfolios = groups.filter((g) => g.companies.length > 1);
  const singles = groups.filter((g) => g.companies.length === 1);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Investors" subtitle="Which funds back which companies on the patch" actions={<Button variant="ghost" size="sm" onClick={() => void refetch()}>Reload</Button>} />
      <main className="container mx-auto px-6 py-5 space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Loading the funds…</p>}
        {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">{data.groups.length} {data.groups.length === 1 ? "fund" : "funds"} across {data.withInvestors} of {data.companies} companies.</p>
              <SourceNote text={SOURCE} />
              <div className="ml-auto">
                <label htmlFor="investor-search" className="sr-only">Search funds and companies</label>
                <Input id="investor-search" className="h-8 w-64" placeholder="Search a fund or a company" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>
            {data.groups.length === 0 && <p className="text-sm text-muted-foreground">No investor is named yet. A company's investors come from its own website and the funding news once it has been analysed.</p>}
            {portfolios.length > 0 && (
              <Card className="p-5">
                <h2 className="mb-3 text-base font-bold text-foreground">Portfolios on the patch</h2>
                <ul className="divide-y divide-border/60" aria-label="Funds with two or more companies">
                  {portfolios.map((g) => (
                    <li key={g.key} className="py-3">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold text-foreground">{g.name}</span>
                        <span className="text-xs text-muted-foreground">{g.companies.length} companies</span>
                      </div>
                      <ul className="mt-1.5 flex flex-wrap gap-2">
                        {g.companies.map((c) => {
                          const band = scoreBand(c.score);
                          return (
                            <li key={c.id} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs">
                              <Link to={`/companies/${c.id}`} className="font-medium text-foreground hover:underline">{c.name}</Link>
                              {c.score !== null && band ? <span className={`rounded border px-1 text-[11px] font-semibold tabular-nums ${BAND_CLASSES[band]}`}>{c.score}</span> : null}
                              <span className="text-muted-foreground">{[c.fundingStage && c.fundingStage !== "Unknown" ? c.fundingStage : null, c.raise, STAGE_LABELS[stageOf(c.pipelineStage)]].filter(Boolean).join(" · ")}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {singles.length > 0 && (
              <Card className="p-5">
                <h2 className="mb-3 text-base font-bold text-foreground">One company each</h2>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Funds with one company">
                  {singles.map((g) => (
                    <li key={g.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium text-foreground">{g.name}</span>
                      <span className="text-xs text-muted-foreground">backs <Link to={`/companies/${g.companies[0].id}`} className="text-primary hover:underline">{g.companies[0].name}</Link></span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
