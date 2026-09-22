import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Eye, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { ALLOWED_DOMAINS, useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AppHeader } from "@/components/AppHeader";
import { RaisesDigestCard } from "@/components/RaisesDigestCard";

type Setting = Tables<"vacancy_alert_settings">;
type Consultant = Tables<"consultants">;

const ALERT_LABEL = "New roles at my companies";

/**
 * Alert settings, per consultant: the new-roles alert, who receives it, a
 * dry-run preview, and the Friday brief's copy recipients.
 */
export default function Alerts() {
  const { user, profile, isManager } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [busy, setBusy] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [sendingBrief, setSendingBrief] = useState(false);
  const [confirmBrief, setConfirmBrief] = useState(false);
  const [form, setForm] = useState({ consultantId: "", name: "", email: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setBusy(true);
    const [s, c] = await Promise.all([
      supabase.from("vacancy_alert_settings").select("*").order("created_at"),
      supabase.from("consultants").select("*").order("name"),
    ]);
    setBusy(false);
    if (s.error || c.error) { toast({ title: "Could not load", description: (s.error || c.error)!.message, variant: "destructive" }); return; }
    setSettings(s.data || []);
    setConsultants(c.data || []);
  };
  useEffect(() => { void load(); }, []);

  const consultantById = useMemo(() => new Map(consultants.map((c) => [c.id, c])), [consultants]);

  // The directors receive a copy of every consultant's Friday brief
  // (app_settings.brief_copy_recipients), and each consultant row can name
  // extra copy recipients (consultants.brief_copies).
  const [directors, setDirectors] = useState<string[]>([]);
  const [directorsText, setDirectorsText] = useState("");
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "brief_copy_recipients").maybeSingle();
      const list = Array.isArray(data?.value) ? (data!.value as unknown[]).map((x) => String(x).toLowerCase()) : [];
      setDirectors(list);
      setDirectorsText(list.join(", "));
    })();
  }, []);
  const parseAddresses = (text: string) => [...new Set(text.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@")))];
  const saveDirectors = async () => {
    const list = parseAddresses(directorsText);
    if (list.join(",") === directors.join(",")) return;
    const { error } = await supabase.from("app_settings").upsert({ key: "brief_copy_recipients", value: list, updated_by: user?.id ?? null });
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    setDirectors(list);
    toast({ title: "Saved", description: list.length ? `Every consultant's brief also goes to ${list.join(", ")}.` : "No director copies." });
  };
  const saveCopies = async (c: Consultant, text: string) => {
    const list = parseAddresses(text);
    if (list.join(",") === (c.brief_copies || []).join(",")) return;
    const { error } = await supabase.from("consultants").update({ brief_copies: list }).eq("id", c.id);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    setConsultants((prev) => prev.map((x) => (x.id === c.id ? { ...x, brief_copies: list } : x)));
    toast({ title: "Saved", description: list.length ? `${c.name}'s brief also goes to ${list.join(", ")}.` : `No extra copies of ${c.name}'s brief.` });
  };
  const grouped = useMemo(() => {
    const groups = new Map<string, Setting[]>();
    for (const s of settings) {
      const key = s.consultant_id || "none";
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
    }
    const order = [...groups.keys()].sort((a, b) => (consultantById.get(a)?.name || "zz").localeCompare(consultantById.get(b)?.name || "zz"));
    return order.map((k) => ({ key: k, consultant: consultantById.get(k) || null, items: groups.get(k)! }));
  }, [settings, consultantById]);

  const recipientsOf = (s: Setting) => {
    const out: string[] = [];
    const add = (e?: string | null) => { const v = (e || "").trim().toLowerCase(); if (v && !out.includes(v)) out.push(v); };
    add(s.email);
    if (!s.email && s.consultant_id) add(consultantById.get(s.consultant_id)?.email);
    for (const e of s.extra_recipients || []) add(e);
    return out;
  };

  const notYours = "Only the person this alert belongs to, or a manager, can change it.";
  const patch = async (id: string, values: Partial<Setting>, okTitle?: string) => {
    const { error, count } = await supabase.from("vacancy_alert_settings").update(values, { count: "exact" }).eq("id", id);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    if (count === 0) { toast({ title: "Not saved", description: notYours, variant: "destructive" }); return; }
    if (okTitle) toast({ title: okTitle });
    await load();
  };
  const remove = async (s: Setting) => {
    const { error, count } = await supabase.from("vacancy_alert_settings").delete({ count: "exact" }).eq("id", s.id);
    if (error) { toast({ title: "Could not delete", description: error.message, variant: "destructive" }); return; }
    if (count === 0) { toast({ title: "Not deleted", description: notYours, variant: "destructive" }); return; }
    toast({ title: "Alert removed", description: s.name || s.email || "" });
    await load();
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const c = consultantById.get(form.consultantId);
    if (!c) { toast({ title: "Pick a consultant", variant: "destructive" }); return; }
    setSaving(true);
    const { error } = await supabase.from("vacancy_alert_settings").insert({
      name: form.name.trim() || `${c.name}: new roles`,
      alert_type: "new_vacancy",
      consultant_id: c.id,
      consultant_filter: c.name,
      email: form.email.trim().toLowerCase() || null,
      auto_refresh_enabled: true,
      enabled: true,
    });
    setSaving(false);
    if (error) { toast({ title: "Could not add", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Alert added", description: `Goes to ${form.email.trim() || c.email || "the consultant's address (none set yet)"} from the next Friday run.` });
    setForm({ consultantId: "", name: "", email: "" });
    await load();
  };

  // The new-roles alert has no test send: a dry run of the Friday compare
  // reports what would go out and queues nothing.
  const previewAlert = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke("auto-refresh-vacancies", { body: { phase: "compare-and-alert", dryRun: true } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      const me = (user?.email || "").toLowerCase();
      const results = ((data?.results || []) as Array<{ consultant?: string | null; email?: string | null; status?: string; titles?: string[]; error?: string | null }>);
      const mine = results.filter((r) => !me || !r.email || r.email.toLowerCase() === me);
      const shown = mine.length ? mine : results;
      if (shown.length === 0) { setPreview(data?.message || "No alert settings are enabled, so nothing would go out."); return; }
      setPreview(shown.map((r) => `${r.consultant || r.email || "alert"}: ${r.titles?.length ? `${r.titles.length} new role${r.titles.length === 1 ? "" : "s"} this week (${r.titles.slice(0, 8).join("; ")}${r.titles.length > 8 ? "; …" : ""})` : r.error ? `error: ${r.error}` : `nothing new (${r.status || "skipped"})`}`).join("\n"));
    } catch (e) {
      toast({ title: "Preview failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
    setPreviewing(false);
  };

  // The Friday brief, test-sent to the signed-in person only (their own
  // consultant edition, and the manager edition when they are a manager).
  const sendBriefTest = async () => {
    if (!user?.email) return;
    setSendingBrief(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-friday-brief", { body: { testEmail: user.email } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      const sent = ((data?.results || []) as Array<{ status?: string; kind?: string }>).filter((r) => r.status === "sent");
      toast({ title: sent.length ? "Test brief sent" : "Nothing to send", description: data?.message || `${sent.length} email${sent.length === 1 ? "" : "s"} to ${user.email}: ${sent.map((r) => r.kind === "manager" ? "the manager edition" : "your own list").join(" and ")}.` });
    } catch (e) {
      toast({ title: "Test failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
    setSendingBrief(false);
  };

  const canEdit = (s: Setting) => isManager || (s.email || "").toLowerCase() === (profile?.email || "").toLowerCase() || (s.consultant_id && (consultantById.get(s.consultant_id)?.email || "").toLowerCase() === (profile?.email || "").toLowerCase());

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Alerts" subtitle="The weekly new-roles alert and the Friday brief, per consultant" actions={<>
        <Button variant="outline" size="sm" onClick={() => void previewAlert()} disabled={previewing} className="h-8 gap-1.5 text-xs">{previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}Preview this week's alert</Button>
        <Button variant="outline" size="sm" onClick={() => setConfirmBrief(true)} disabled={sendingBrief} className="h-8 gap-1.5 text-xs">{sendingBrief ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}Send me a test Friday brief</Button>
      </>} />
      <main className="container mx-auto px-6 py-6 space-y-6">
        <p className="text-sm text-muted-foreground">The new-roles alert goes out on Friday mornings after the 07:30 UTC compare: every role that appeared at a consultant's companies since the last run, talent roles first. Each setting covers the companies assigned to its consultant. The preview is a dry run and sends nothing.</p>

        {preview && <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground" role="status">{preview}</pre>}

        {busy && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Loading…</p>}
        {!busy && grouped.length === 0 && <p className="text-sm text-muted-foreground">No alert settings yet.</p>}

        {grouped.map((g) => (
          <Card key={g.key} className="p-5">
            <h2 className="text-base font-semibold text-foreground">{g.consultant?.name || "No consultant (legacy)"}{g.consultant?.email ? <span className="ml-2 text-xs font-normal text-muted-foreground">{g.consultant.email}</span> : null}</h2>
            <ul className="mt-3 divide-y divide-border/60">
              {g.items.map((s) => (
                <li key={s.id} className="py-3 grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-start">
                  <Switch checked={s.enabled !== false} onCheckedChange={(v) => void patch(s.id, { enabled: v }, v ? "Alert on" : "Alert off")} aria-label={`${s.name || ALERT_LABEL} enabled`} disabled={!canEdit(s)} />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{s.name || ALERT_LABEL}
                      <span className="ml-2 text-xs text-muted-foreground">{s.alert_type === "new_vacancy" ? "new roles, Friday mornings" : s.alert_type}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">To: {recipientsOf(s).join(", ") || "nobody (set the consultant's email)"}{!s.consultant_id && s.consultant_filter ? ` · tag "${s.consultant_filter}"` : ""}</p>
                    {canEdit(s) && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <Label htmlFor={`extra-${s.id}`} className="text-xs text-muted-foreground">Also send to</Label>
                        <Input id={`extra-${s.id}`} className="h-7 w-72 text-xs" defaultValue={(s.extra_recipients || []).join(", ")} placeholder={`name@${ALLOWED_DOMAINS[0]}, another@…`}
                          onBlur={(e) => { const list = parseAddresses(e.target.value); if (list.join(",") !== (s.extra_recipients || []).join(",")) void patch(s.id, { extra_recipients: list }, "Recipients saved"); }} />
                      </div>
                    )}
                  </div>
                  {canEdit(s) && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => void remove(s)} aria-label={`Delete ${s.name || "alert"}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>}
                </li>
              ))}
            </ul>
          </Card>
        ))}

        <Card className="p-5">
          <h2 className="text-base font-semibold text-foreground">Friday brief</h2>
          <p className="mt-1 text-sm text-muted-foreground">Every Friday morning each consultant gets their companies worth a call or more, ranked by how likely they are to buy now; managers get the picture across the team. A copy of every consultant's brief also goes to the directors, with the subject prefixed by the consultant's name.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Label htmlFor="brief-directors" className="text-sm">Also send every consultant's brief to</Label>
            <Input id="brief-directors" className="h-8 w-96 max-w-full text-sm" value={directorsText} onChange={(e) => setDirectorsText(e.target.value)} onBlur={() => void saveDirectors()} placeholder={`craig@${ALLOWED_DOMAINS[0]}`} disabled={!isManager} aria-describedby="brief-directors-help" />
            <span id="brief-directors-help" className="text-xs text-muted-foreground">{isManager ? "Comma-separated; saved when you leave the box." : "Managers can change this."}</span>
          </div>
          {isManager && consultants.filter((c) => c.active).length > 0 && (
            <ul className="mt-3 divide-y divide-border/60">
              {consultants.filter((c) => c.active).map((c) => (
                <li key={c.id} className="py-2 flex flex-wrap items-center gap-2 text-xs">
                  <Label htmlFor={`brief-copies-${c.id}`} className="text-xs text-muted-foreground w-56 truncate">Copies of {c.name}'s brief also go to</Label>
                  <Input id={`brief-copies-${c.id}`} className="h-7 w-72 text-xs" defaultValue={(c.brief_copies || []).join(", ")} placeholder={`name@${ALLOWED_DOMAINS[0]}`} onBlur={(e) => void saveCopies(c, e.target.value)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <RaisesDigestCard />

        <Card className="p-5">
          <h2 className="text-base font-semibold text-foreground mb-3">Add an alert</h2>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <div>
              <Label htmlFor="add-consultant">Consultant</Label>
              <Select value={form.consultantId} onValueChange={(v) => setForm({ ...form, consultantId: v })}>
                <SelectTrigger id="add-consultant"><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>{consultants.filter((c) => c.active).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="add-type">Type</Label>
              <Select value="new_vacancy" disabled>
                <SelectTrigger id="add-type"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="new_vacancy">{ALERT_LABEL}</SelectItem></SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="add-email">Send to (blank = consultant's email)</Label>
              <Input id="add-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={consultantById.get(form.consultantId)?.email || ""} />
            </div>
            <div>
              <Label htmlFor="add-name">Name (optional)</Label>
              <Input id="add-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <Button type="submit" disabled={saving || !form.consultantId} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}Add</Button>
          </form>
        </Card>
      </main>

      <AlertDialog open={confirmBrief} onOpenChange={setConfirmBrief}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send a test Friday brief to yourself?</AlertDialogTitle>
            <AlertDialogDescription>This sends the brief as it would go out on Friday, to {user?.email || "your address"} only: your own ranked list when companies are assigned to your address, and the manager edition when you are a manager. Nobody else receives anything.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmBrief(false); void sendBriefTest(); }}>Send to me</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
