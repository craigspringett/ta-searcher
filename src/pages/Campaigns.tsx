import { Link } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { formatWhen } from "@/lib/patch";
import { useCampaigns } from "@/lib/campaignsData";

const statusWords: Record<string, string> = { active: "Running", paused: "Paused", stopped: "Stopped" };

/** Follow-up campaigns (Craig, 18 November 2026): the batches you have started. */
export default function Campaigns() {
  const { data, isLoading, error } = useCampaigns();
  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Follow-up campaigns" subtitle="Set up a batch of follow-ups in one go, then approve each first email yourself" />
      <main className="container mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6">
        <div className="flex justify-end"><Button asChild><Link to="/campaigns/new" className="gap-1.5"><Plus className="h-4 w-4" aria-hidden="true" />New campaign</Link></Button></div>
        {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Loading…</p>}
        {error && <p className="text-sm text-critical" role="alert">Could not load: {(error as Error).message}</p>}
        {data && data.length === 0 && <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">No campaigns yet. Press New campaign to pick contacts and set one up.</p>}
        {data && data.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border">
          {data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <Link to={`/campaigns/${c.id}`} className="font-medium text-foreground hover:underline">{c.name}</Link>
                <p className="text-xs text-muted-foreground">{c.contacts} contact{c.contacts === 1 ? "" : "s"} · {c.sent} first email{c.sent === 1 ? "" : "s"} sent · started {formatWhen(c.created_at)}</p>
              </div>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{statusWords[c.status] || c.status}</span>
            </li>
          ))}
        </ul>}
      </main>
    </div>
  );
}
