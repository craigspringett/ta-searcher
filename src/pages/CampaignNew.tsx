import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExampleBox } from "@/components/ExampleBox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatIsoDateUk } from "@/lib/format";
import { STAGE_LABELS, PIPELINE_STAGES } from "@/lib/pipeline";
import { useAuth } from "@/lib/auth";
import { canPick, companyLine, DEFAULT_STAGES, FUNDING_STAGE_LABELS, type FundingStage, MAX_CAMPAIGN_CONTACTS, MAX_STAGE_EXAMPLE, MAX_STAGE_NOTE, MAX_CAMPAIGN_STEPS, MAX_PER_COMPANY, validateCampaign, type PickedContact, type Stage, type StageKind } from "@/lib/campaigns";
import { callCampaigns, campaignsKey, stagesToPlan, usePicker } from "@/lib/campaignsData";

/**
 * New follow-up campaign (Craig, 18 November 2026): pick up to 15 contacts
 * (two at most at one company), name it, say what the emails are about and set
 * the stages once. The emails are then written for each contact and you
 * approve each first email yourself.
 */
export default function CampaignNew() {
  const { user, profile, isManager } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: picker, isLoading, error } = usePicker(user?.email || "", user?.id || "", profile?.consultant_id || null);
  const [name, setName] = useState("");
  const [angle, setAngle] = useState("");
  const [stages, setStages] = useState<Stage[]>(DEFAULT_STAGES);
  const [autoAfterFirst, setAutoAfterFirst] = useState(true);
  const [alike, setAlike] = useState(false);
  const [picked, setPicked] = useState<PickedContact[]>([]);
  const [text, setText] = useState("");
  // A manager sees every company and can narrow by consultant; anyone else sees only their own.
  const [consultant, setConsultant] = useState<string>("all");
  const [stage, setStage2] = useState<string>("all");
  const [sector, setSector] = useState<string>("all");
  const [pipeline, setPipeline] = useState<string>("all");
  const [onlyRoles, setOnlyRoles] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const sectors = useMemo(() => Array.from(new Set((picker?.companies || []).map((c) => c.sector))).sort((a, b) => a.localeCompare(b)), [picker]);
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (picker?.companies || []).filter((c) => (isManager ? (consultant === "all" || (consultant === "none" ? c.consultantIds.length === 0 : c.consultantIds.includes(consultant))) : c.mine)
      && (stage === "all" || c.stage === stage) && (sector === "all" || c.sector === sector) && (pipeline === "all" || c.pipelineStage === pipeline)
      && (!onlyRoles || c.openRoles > 0) && c.contacts.some((x) => x.email) && (!q || c.name.toLowerCase().includes(q)));
  }, [picker, text, consultant, stage, sector, pipeline, onlyRoles, isManager]);
  const shown = matches.slice(0, 80);
  const matching = matches.length;

  const toggle = (c: PickedContact, on: boolean) => {
    setProblem(null);
    if (!on) { setPicked((p) => p.filter((x) => x.email.toLowerCase() !== c.email.toLowerCase())); return; }
    const r = canPick(picked, c);
    if (!r.ok) { setProblem(r.reason); return; }
    setPicked((p) => [...p, c]);
  };
  const setStageField = (id: number, patch: Partial<Stage>) => setStages((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const invalid = validateCampaign(name, stages, picked);

  const create = async () => {
    if (invalid) { setProblem(invalid); return; }
    setBusy(true); setProblem(null);
    try {
      const { status, data } = await callCampaigns({
        action: "create", name, angle, plan: stagesToPlan(stages), autoAfterFirst, writeAlike: alike,
        contacts: picked.map((p) => ({ companySearchId: p.companyId, contactName: p.name, contactEmail: p.email, contactRole: p.role })),
      });
      if (status >= 400 || !data.campaignId) {
        const why = (data.skipped || []).map((s) => `${s.contactName} (${s.companyName}): ${s.reason}`).join(" ");
        setProblem(`${data.error || `HTTP ${status}`} ${why}`.trim());
        return;
      }
      void queryClient.invalidateQueries({ queryKey: campaignsKey });
      navigate(`/campaigns/${data.campaignId}`, { state: { skipped: data.skipped || [] } });
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="New follow-up campaign" subtitle={`Up to ${MAX_CAMPAIGN_CONTACTS} contacts, ${MAX_PER_COMPANY} at most at one company. You approve every first email yourself.`} />
      <main className="container mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[3fr_2fr]">
        <section aria-label="Pick contacts" className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56"><Label htmlFor="cn-search" className="text-xs text-muted-foreground">Find a company</Label><Input id="cn-search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Company name" /></div>
            {isManager ? (
              <div>
                <Label htmlFor="cn-cons" className="text-xs text-muted-foreground">Consultant</Label>
                <Select value={consultant} onValueChange={setConsultant}>
                  <SelectTrigger id="cn-cons" className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All companies</SelectItem>
                    {(picker?.consultants || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    <SelectItem value="none">No consultant yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : <span className="pb-2 text-xs text-muted-foreground">Your companies</span>}
            <div>
              <Label htmlFor="cn-stage" className="text-xs text-muted-foreground">Funding stage</Label>
              <Select value={stage} onValueChange={setStage2}>
                <SelectTrigger id="cn-stage" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any stage</SelectItem>
                  {(Object.keys(FUNDING_STAGE_LABELS) as FundingStage[]).map((k) => <SelectItem key={k} value={k}>{FUNDING_STAGE_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cn-sector" className="text-xs text-muted-foreground">Sector</Label>
              <Select value={sector} onValueChange={setSector}>
                <SelectTrigger id="cn-sector" className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any sector</SelectItem>
                  {sectors.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cn-pipeline" className="text-xs text-muted-foreground">Pipeline stage</Label>
              <Select value={pipeline} onValueChange={setPipeline}>
                <SelectTrigger id="cn-pipeline" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any stage</SelectItem>
                  {PIPELINE_STAGES.map((k) => <SelectItem key={k} value={k}>{STAGE_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={onlyRoles} onChange={(e) => setOnlyRoles(e.target.checked)} />With open roles</label>
          </div>
          {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />Loading companies…</p>}
          {matching > shown.length && <p className="text-xs text-muted-foreground">Showing the first {shown.length} of {matching} companies. Search or use the filters to narrow the list.</p>}
          {error && <p className="text-sm text-critical" role="alert">Could not load: {(error as Error).message}</p>}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shown.map((s) => {
              const isOpen = open === s.id;
              const count = picked.filter((p) => p.companyId === s.id).length;
              return (
                <li key={s.id} className="px-3 py-2 text-sm">
                  <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                    <span><span className="font-medium text-foreground">{s.name}</span><span className="ml-2 text-xs text-muted-foreground">{companyLine(s.stage, s.sector, s.openRoles)}{isManager && s.consultantIds.length ? ` · ${s.consultantIds.map((id) => picker?.consultants.find((c) => c.id === id)?.name).filter(Boolean).join(", ")}` : ""}</span>{s.openRoles > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild><span className="ml-2 cursor-help text-xs text-primary underline decoration-dotted">{s.openRoles} open role{s.openRoles === 1 ? "" : "s"}</span></TooltipTrigger>
                        <TooltipContent side="bottom" align="start" className="max-w-sm">
                          <p className="mb-1 text-xs font-medium">Open at {s.name}</p>
                          <ul className="space-y-0.5 text-xs">
                            {s.roles.slice(0, 10).map((v, i) => <li key={i}>{v.title}{v.firstSeen ? <span className="text-muted-foreground"> (listed {formatIsoDateUk(v.firstSeen)})</span> : null}</li>)}
                            {s.roles.length > 10 && <li className="text-muted-foreground">and {s.roles.length - 10} more</li>}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    )}</span>
                    {count > 0 && <span className="rounded bg-primary/15 px-1.5 text-xs font-semibold text-primary">{count} picked</span>}
                  </button>
                  {isOpen && (
                    <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                      {s.contacts.map((c, i) => {
                        const hasEmail = !!c.email;
                        const pc: PickedContact = { companyId: s.id, companyName: s.name, name: c.name, role: c.role, email: (c.email || "") };
                        const isPicked = hasEmail && picked.some((p) => p.email.toLowerCase() === pc.email.toLowerCase());
                        const can = isPicked || (hasEmail && canPick(picked, pc).ok);
                        return (
                          <li key={`${c.email || c.name}-${i}`}>
                            <label className={`flex items-start gap-2 ${c.running || !hasEmail ? "opacity-60" : ""}`}>
                              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={isPicked} disabled={c.running || !hasEmail || !can} onChange={(e) => toggle(pc, e.target.checked)} />
                              <span><span className="text-foreground">{c.name}</span>{c.role ? <span className="text-muted-foreground">, {c.role}</span> : null}<span className="block text-xs text-muted-foreground">{hasEmail ? c.email : "No email address yet"}{c.running ? " · follow-ups already running" : ""}</span></span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
            {!isLoading && shown.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">No companies match. Clear the search or the filters.</li>}
          </ul>
        </section>

        <section aria-label="Campaign details" className="space-y-3">
          <Card className="space-y-3 p-4">
            <div><Label htmlFor="cn-name">Campaign name</Label><Input id="cn-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="SEN TA push, w/c 24 Nov" /></div>
            <div>
              <Label htmlFor="cn-angle">What is the campaign about, overall?</Label>
              <Textarea id="cn-angle" value={angle} onChange={(e) => setAngle(e.target.value)} rows={4} maxLength={1500} placeholder="The angle every email is written around, in your own words: for example, we have strong SEN TAs available to start in January and can cover a long-term vacancy." />
              <p className="mt-1 text-xs text-muted-foreground">Below you can say what each email should be about and drag in an email to base it on.</p>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-foreground">Stages (the same for everyone)</p>
              <ul className="space-y-2">
                {stages.map((s, i) => {
                  const emailNo = stages.slice(0, i + 1).filter((x) => x.kind === "email").length;
                  return (
                    <li key={s.id} className="rounded-md border border-border/60 p-2 text-sm">
                      <div className="flex items-center gap-2">
                        {i === 0 ? <span className="w-28 text-foreground">Email 1</span> : (
                          <Select value={s.kind} onValueChange={(v) => setStageField(s.id, { kind: v as StageKind })}>
                            <SelectTrigger className="w-28" aria-label="Kind"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="call">Call</SelectItem></SelectContent>
                          </Select>
                        )}
                        <span className="text-muted-foreground">day</span>
                        {i === 0 ? <span className="w-16 text-foreground">0</span> : <Input type="number" min={1} max={60} className="w-16" value={s.day} onChange={(e) => setStageField(s.id, { day: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} aria-label="Day" />}
                        {s.kind === "email" && i > 0 && <span className="text-xs text-muted-foreground">email {emailNo}</span>}
                        {i > 0 && <Button type="button" variant="ghost" size="icon" className="ml-auto" aria-label="Remove this stage" onClick={() => setStages((x) => x.filter((y) => y.id !== s.id))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>}
                      </div>
                      {s.kind === "email" && (
                        <div className="mt-2 space-y-2">
                          <div>
                            <Label htmlFor={`cn-note-${s.id}`} className="text-xs text-muted-foreground">What should email {emailNo} be about? (optional)</Label>
                            <Input id={`cn-note-${s.id}`} value={s.note || ""} maxLength={MAX_STAGE_NOTE} onChange={(e) => setStageField(s.id, { note: e.target.value })} placeholder={emailNo === 1 ? "Introduce us and the candidates we have" : emailNo === 2 ? "Follow up with a real example of a placement" : "A last light touch, door left open"} />
                          </div>
                          <div>
                            <Label htmlFor={`cn-ex-${s.id}`} className="text-xs text-muted-foreground">An email to base it on (optional): paste text, drag it in, or drop a Word (.docx), .txt, .eml or .html file</Label>
                            <ExampleBox id={`cn-ex-${s.id}`} value={s.example || ""} onChange={(v) => setStageField(s.id, { example: v })} maxLength={MAX_STAGE_EXAMPLE} rows={3} placeholder="An email you sent before that worked, or one you like" />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {stages.length < MAX_CAMPAIGN_STEPS && <Button type="button" variant="outline" size="sm" className="mt-2 gap-1" onClick={() => setStages((x) => [...x, { id: Math.max(...x.map((y) => y.id)) + 1, kind: "email", day: (x[x.length - 1]?.day || 0) + 4 }])}><Plus className="h-4 w-4" aria-hidden="true" />Add a stage</Button>}
            </div>
            <fieldset className="space-y-1.5 rounded-md border border-border p-3 text-sm">
              <legend className="px-1 text-sm font-medium text-foreground">How alike should the emails be?</legend>
              <label className="flex items-start gap-2"><input type="radio" name="cn-alike" className="mt-0.5 h-4 w-4" checked={!alike} onChange={() => setAlike(false)} /><span><span className="text-foreground">Write each one for its own company</span><span className="block text-xs text-muted-foreground">Every contact's email is different, built from what we know about their company.</span></span></label>
              <label className="flex items-start gap-2"><input type="radio" name="cn-alike" className="mt-0.5 h-4 w-4" checked={alike} onChange={() => setAlike(true)} /><span><span className="text-foreground">Write them all alike</span><span className="block text-xs text-muted-foreground">The first contact's emails are written first and the others follow them closely, changing only the greeting, the company's name and a detail that fits. You can still read and edit every one.</span></span></label>
            </fieldset>
            <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={autoAfterFirst} onChange={(e) => setAutoAfterFirst(e.target.checked)} />
              <span><span className="font-medium text-foreground">Approved emails go out by themselves on their day</span><span className="block text-xs text-muted-foreground">You read and approve every email, first and later, one at a time; the first goes when you approve it. Untick and the later ones wait for you to send each by hand.</span></span>
            </label>
          </Card>
          <Card className="space-y-2 p-4">
            <p className="text-sm font-medium text-foreground">{picked.length} of {MAX_CAMPAIGN_CONTACTS} contacts picked</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {picked.map((p) => (
                <li key={p.email} className="flex items-center justify-between gap-2"><span><span className="text-foreground">{p.name}</span>, {p.companyName}</span><button type="button" className="text-muted-foreground underline hover:text-foreground" onClick={() => toggle(p, false)}>remove</button></li>
              ))}
            </ul>
            {problem && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-foreground" role="alert">{problem}</p>}
            <Button type="button" onClick={() => void create()} disabled={busy || !!invalid} className="gap-2">{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{busy ? "Creating…" : "Create the campaign and write the emails"}</Button>
            {invalid && picked.length > 0 && <p className="text-xs text-muted-foreground">{invalid}</p>}
          </Card>
        </section>
      </main>
    </div>
  );
}
