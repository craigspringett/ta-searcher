import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RunInfo {
  startTime: string;
  endTime: string | null;
  status: string;
  durationMs: number | null;
  returnMessage?: string | null;
}

interface JobStatus {
  key: string;
  label: string;
  jobname: string;
  schedule: string | null;
  active: boolean;
  configured: boolean;
  lastRun: RunInfo | null;
  recentRuns: RunInfo[];
}

interface EmailCounter {
  sent: number;
  failed: number;
  suppressed: number;
  total: number;
  lastSentAt: string | null;
}

interface CompareRun {
  configId: string;
  consultant: string | null;
  email: string | null;
  newCount: number | null;
  companiesTotal: number | null;
  companiesRefreshedToday: number | null;
  status: string;
  dryRun: boolean;
  finishedAt: string | null;
}

interface PipelineHealth {
  companiesRefreshedToday: number;
  degradedToday: number;
  failedRunsToday: number;
  snapshotAt: string | null;
  compareRuns: CompareRun[];
  dlqDepth: number;
  teachingVacanciesSync: { finishedAt?: string; status?: string; count?: number; error?: string | null };
  openVacancies: number;
  newVacanciesToday: number;
}

interface AiUsageDay {
  day: string;
  model: string;
  provider: string;
  calls: number;
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  cost_usd: number;
  failed: number;
}

interface AiUsageSummary {
  byDay: AiUsageDay[];
  today: { calls: number; costUsd: number; companies: number };
  month: { calls: number; costUsd: number; companies: number };
  copyQueuePending: number;
  copyGeneratedToday: number;
}

interface MonitoringResponse {
  jobs: JobStatus[];
  emailCounters: Record<string, EmailCounter>;
  emailsByDay: Record<string, Record<string, number>>;
  pipeline?: PipelineHealth | null;
  aiUsage?: AiUsageSummary | null;
  generatedAt: string;
}

const usd = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const tokens = (n: number) => Number(n || 0).toLocaleString("en-GB");

const formatDuration = (ms: number | null) => {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
};

const formatTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const StatusBadge = ({ status }: { status: string | undefined }) => {
  if (!status) return <Badge variant="outline">No runs yet</Badge>;
  const lower = status.toLowerCase();
  if (lower === "succeeded" || lower === "success" || lower === "sent")
    return (
      <Badge className="bg-positive hover:bg-positive text-positive-foreground">
        <CheckCircle2 className="w-3 h-3 mr-1" /> {status}
      </Badge>
    );
  if (lower === "failed" || lower === "failure" || lower === "error")
    return (
      <Badge variant="destructive">
        <XCircle className="w-3 h-3 mr-1" /> {status}
      </Badge>
    );
  if (lower === "running" || lower === "starting")
    return (
      <Badge className="bg-primary hover:bg-primary text-primary-foreground">
        <Activity className="w-3 h-3 mr-1" /> {status}
      </Badge>
    );
  return <Badge variant="outline">{status}</Badge>;
};

const TEMPLATE_LABELS: Record<string, string> = {
  "new-vacancies-alert": "New Vacancies Alerts",
  "vacancy-deadline-alert": "Deadline Alerts",
};


export default function PipelineMonitoring() {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: err } = await supabase.functions.invoke("cron-monitoring");
      if (err) throw err;
      setData(res as MonitoringResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast({
        title: "Failed to load monitoring data",
        description: e?.message || String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Monitoring" subtitle="The overnight jobs, the email queue and the model spend, refreshed every minute" actions={<Button onClick={load} disabled={loading} variant="outline" size="sm" className="h-8 gap-1.5 text-xs"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />Refresh</Button>} />
      <div className="container mx-auto space-y-6 px-4 py-5 sm:px-6">
        {error && (
          <Card className="border-destructive">
            <CardContent className="pt-6 flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </CardContent>
          </Card>
        )}

        {/* Cron job cards */}
        <section>
          <h2 className="text-xl font-semibold mb-3">Scheduled Jobs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {data?.jobs.map((job) => {
              const last = job.lastRun;
              const ok = last?.status?.toLowerCase() === "succeeded";
              return (
                <Card key={job.key} className={!last ? "border-muted" : ok ? "border-green-200" : "border-destructive/50"}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{job.label}</CardTitle>
                      <StatusBadge status={last?.status} />
                    </div>
                    <CardDescription className="text-xs font-mono">
                      {job.schedule ?? "(not scheduled)"} {job.active ? "" : "· paused"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Last run
                      </span>
                      <span className="font-medium">{formatTime(last?.startTime ?? null)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium">{formatDuration(last?.durationMs ?? null)}</span>
                    </div>
                    {last?.returnMessage && (
                      <div className="text-xs text-muted-foreground border-t pt-2 mt-2 font-mono break-words">
                        {last.returnMessage.length > 120
                          ? last.returnMessage.slice(0, 120) + "…"
                          : last.returnMessage}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {!data && loading && (
              <Card className="col-span-full">
                <CardContent className="pt-6 text-muted-foreground">Loading…</CardContent>
              </Card>
            )}
          </div>
        </section>

        {/* Email counters */}
        <section>
          <h2 className="text-xl font-semibold mb-3">Email Delivery (last 30 days)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data &&
              Object.entries(data.emailCounters).map(([template, c]) => (
                <Card key={template}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Mail className="w-4 h-4" /> {TEMPLATE_LABELS[template] ?? template}
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">
                        Last sent: {formatTime(c.lastSentAt)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div>
                        <div className="text-2xl font-bold">{c.total}</div>
                        <div className="text-xs text-muted-foreground">Total</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-positive">{c.sent}</div>
                        <div className="text-xs text-muted-foreground">Sent</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-destructive">{c.failed}</div>
                        <div className="text-xs text-muted-foreground">Failed</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-warning">{c.suppressed}</div>
                        <div className="text-xs text-muted-foreground">Suppressed</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </section>

        {/* Pipeline health (Phase 1) */}
        {data?.pipeline && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Pipeline Health (today, UTC)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
              {[
                { label: "Companies refreshed", value: data.pipeline.companiesRefreshedToday },
                { label: "Degraded runs", value: data.pipeline.degradedToday },
                { label: "Failed runs", value: data.pipeline.failedRunsToday },
                { label: "Open vacancies", value: data.pipeline.openVacancies },
                { label: "New today", value: data.pipeline.newVacanciesToday },
                { label: "Email DLQ depth", value: data.pipeline.dlqDepth },
                { label: "Snapshot", value: formatTime(data.pipeline.snapshotAt) },
              ].map((t) => (
                <Card key={t.label}>
                  <CardContent className="pt-4 pb-3 text-center">
                    <div className="text-xl font-bold">{t.value}</div>
                    <div className="text-xs text-muted-foreground">{t.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Teaching Vacancies mirror: {data.pipeline.teachingVacanciesSync?.finishedAt ? `${data.pipeline.teachingVacanciesSync.count ?? "?"} listings, synced ${formatTime(data.pipeline.teachingVacanciesSync.finishedAt)} (${data.pipeline.teachingVacanciesSync.status})` : "never synced"}
            </p>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Consultant</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Companies</TableHead>
                      <TableHead>Refreshed</TableHead>
                      <TableHead>New</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Finished</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pipeline.compareRuns.map((r) => (
                      <TableRow key={`${r.configId}-${r.finishedAt}`}>
                        <TableCell className="font-medium">{r.consultant ?? "All companies"}</TableCell>
                        <TableCell>{r.email}</TableCell>
                        <TableCell>{r.companiesTotal ?? "—"}</TableCell>
                        <TableCell>{r.companiesRefreshedToday ?? "—"}</TableCell>
                        <TableCell>{r.newCount ?? 0}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.dryRun ? `${r.status} (dry run)` : r.status} />
                        </TableCell>
                        <TableCell>{formatTime(r.finishedAt)}</TableCell>
                      </TableRow>
                    ))}
                    {data.pipeline.compareRuns.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                          No compare runs yet today.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
        )}

        {/* AI spend (Phase 3) */}
        {data?.aiUsage && (
          <section>
            <h2 className="text-xl font-semibold mb-3">AI spend (estimated, USD)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: "Today", value: `${usd(data.aiUsage.today.costUsd)} · ${data.aiUsage.today.calls} calls · ${data.aiUsage.today.companies} companies` },
                { label: "This month", value: `${usd(data.aiUsage.month.costUsd)} · ${data.aiUsage.month.calls} calls` },
                { label: "Scripts written today", value: data.aiUsage.copyGeneratedToday },
                { label: "Waiting in copy queue", value: data.aiUsage.copyQueuePending },
              ].map((t) => (
                <Card key={t.label}>
                  <CardContent className="pt-4 pb-3 text-center">
                    <div className="text-lg font-bold">{t.value}</div>
                    <div className="text-xs text-muted-foreground">{t.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Calls</TableHead>
                      <TableHead>Input</TableHead>
                      <TableHead>Cached</TableHead>
                      <TableHead>Output</TableHead>
                      <TableHead>Failed</TableHead>
                      <TableHead>Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.aiUsage.byDay.map((r) => (
                      <TableRow key={`${r.day}-${r.model}`}>
                        <TableCell>{r.day}</TableCell>
                        <TableCell className="font-medium">{r.model}</TableCell>
                        <TableCell>{r.calls}</TableCell>
                        <TableCell>{tokens(r.input_tokens)}</TableCell>
                        <TableCell>{tokens(r.cached_input_tokens)}</TableCell>
                        <TableCell>{tokens(r.output_tokens)}</TableCell>
                        <TableCell>{r.failed}</TableCell>
                        <TableCell>{usd(r.cost_usd)}</TableCell>
                      </TableRow>
                    ))}
                    {data.aiUsage.byDay.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-6">No model calls in the last fourteen days.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground mt-2">Prices are list prices per million tokens (cached input at a tenth); the providers' invoices are the truth. Gemini on the free tier costs nothing.</p>
          </section>
        )}

        {/* Recent runs table */}
        <section>
          <h2 className="text-xl font-semibold mb-3">Recent Runs</h2>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.jobs
                    .flatMap((j) =>
                      j.recentRuns.map((r) => ({ jobLabel: j.label, ...r })),
                    )
                    .sort((a, b) => (a.startTime < b.startTime ? 1 : -1))
                    .slice(0, 25)
                    .map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.jobLabel}</TableCell>
                        <TableCell>{formatTime(r.startTime)}</TableCell>
                        <TableCell>{formatDuration(r.durationMs)}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  {data && data.jobs.every((j) => j.recentRuns.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No runs recorded yet. Jobs will appear here after their first scheduled execution.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>

        {data && (
          <p className="text-xs text-muted-foreground text-right">
            Last updated: {formatTime(data.generatedAt)} · auto-refresh every 60s
          </p>
        )}
      </div>
    </div>
  );
}
