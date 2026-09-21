import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { ALLOWED_DOMAINS, useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AppHeader } from "@/components/AppHeader";

type Consultant = Tables<"consultants">;
type AlertSetting = Tables<"vacancy_alert_settings">;

/**
 * Manager-only: the consultants, their companies and alerts, and a form to
 * add one. Assigning companies happens on each company card on the
 * Companies page.
 */
export default function Consultants() {
  const { isManager, loading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [companyCounts, setCompanyCounts] = useState<Record<string, number>>({});
  const [companyNames, setCompanyNames] = useState<Record<string, string[]>>({});
  const [alerts, setAlerts] = useState<AlertSetting[]>([]);
  const [busy, setBusy] = useState(true);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    const [c, a, s, v] = await Promise.all([
      supabase.from("consultants").select("*").order("name"),
      supabase.from("company_consultants").select("company_search_id, consultant_id"),
      supabase.from("company_searches").select("id, company_name, analysis_result"),
      supabase.from("vacancy_alert_settings").select("*").order("name"),
    ]);
    setBusy(false);
    if (c.error || a.error || s.error || v.error) {
      toast({ title: "Could not load", description: (c.error || a.error || s.error || v.error)!.message, variant: "destructive" });
      return;
    }
    setConsultants(c.data || []);
    const nameOf = new Map((s.data || []).map((r) => [r.id, ((r.analysis_result as { companyRecord?: { name?: string } } | null)?.companyRecord?.name) || r.company_name]));
    const counts: Record<string, number> = {};
    const names: Record<string, string[]> = {};
    for (const row of a.data || []) {
      counts[row.consultant_id] = (counts[row.consultant_id] || 0) + 1;
      (names[row.consultant_id] ||= []).push(nameOf.get(row.company_search_id) || row.company_search_id);
    }
    for (const k of Object.keys(names)) names[k].sort((x, y) => x.localeCompare(y));
    setCompanyCounts(counts);
    setCompanyNames(names);
    setAlerts(v.data || []);
  };
  useEffect(() => { void load(); }, []);

  const alertsFor = useMemo(() => {
    const map: Record<string, AlertSetting[]> = {};
    for (const a of alerts) if (a.consultant_id) (map[a.consultant_id] ||= []).push(a);
    return map;
  }, [alerts]);

  const addConsultant = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const email = newEmail.trim().toLowerCase();
    if (!name) return;
    setSaving(true);
    const { error } = await supabase.from("consultants").insert({ name, email: email || null });
    setSaving(false);
    if (error) {
      toast({ title: "Could not add", description: error.message.includes("duplicate") ? "A consultant with that name already exists." : error.message, variant: "destructive" });
      return;
    }
    setNewName("");
    setNewEmail("");
    toast({ title: "Consultant added", description: `${name} can now be assigned companies. Add an alert setting on the Alerts page so they get emails.` });
    await load();
  };

  const update = async (c: Consultant, patch: Partial<Consultant>) => {
    const { error } = await supabase.from("consultants").update(patch).eq("id", c.id);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    // Every alert setting carries its own address. When the consultant's
    // address changes, the settings that used the old one follow it; a
    // setting pinned to someone else's address (a copy for a manager) stays.
    if (patch.email !== undefined && c.email && patch.email && patch.email !== c.email) {
      const { error: e2, count } = await supabase.from("vacancy_alert_settings").update({ email: patch.email }, { count: "exact" }).eq("consultant_id", c.id).ilike("email", c.email);
      if (e2) toast({ title: "Consultant saved, alerts not moved", description: e2.message, variant: "destructive" });
      else toast({ title: "Email changed", description: `${count || 0} alert setting${count === 1 ? "" : "s"} now go to ${patch.email}.` });
    } else if (patch.active !== undefined) {
      toast({ title: patch.active ? `${c.name} is active` : `${c.name} is inactive`, description: patch.active ? "Their alerts, brief and weekly refresh are back on." : "Their alerts and brief stop and their companies leave the weekly refresh until switched back on." });
    }
    await load();
  };

  if (loading) return null;
  if (!isManager) {
    return (
      <div className="min-h-screen bg-background px-6 py-10">
        <p className="text-sm text-muted-foreground">This page is for managers. Ask Craig if you need to change who covers a company.</p>
        <Button variant="link" onClick={() => navigate("/")}>Back</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Consultants" subtitle="Who covers which companies, and where their alerts go" />
      <main className="container mx-auto px-6 py-6 space-y-6">
        <Card className="p-5">
          <form onSubmit={addConsultant} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div>
              <Label htmlFor="new-name">Name or list</Label>
              <Input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Craig Springett, or Craig Cold Targets" required />
            </div>
            <div>
              <Label htmlFor="new-email">Email for alerts</Label>
              <Input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder={`name@${ALLOWED_DOMAINS[0]}`} />
            </div>
            <Button type="submit" disabled={saving} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}Add consultant</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">A consultant here is a list of companies with one email. Someone with two lists (a patch and cold targets) has two rows. Assign companies from the company cards on the Companies page.</p>
        </Card>

        {busy ? (
          <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4">Consultant</th>
                  <th className="py-2 pr-4">Email for alerts</th>
                  <th className="py-2 pr-4">Companies</th>
                  <th className="py-2 pr-4">Alerts</th>
                  <th className="py-2 pr-4">Active</th>
                </tr>
              </thead>
              <tbody>
                {consultants.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 align-top">
                    <td className="py-2 pr-4 font-medium">{c.name}</td>
                    <td className="py-2 pr-4">
                      <Input
                        defaultValue={c.email || ""}
                        type="email"
                        aria-label={`Email for ${c.name}`}
                        className="h-8 max-w-xs"
                        onBlur={(e) => { const v = e.target.value.trim().toLowerCase(); if (v !== (c.email || "")) void update(c, { email: v || null }); }}
                      />
                      {(alertsFor[c.id] || []).some((a) => a.email && (!c.email || a.email.toLowerCase() !== c.email.toLowerCase())) && (
                        <p className="mt-1 text-xs text-muted-foreground">Some alerts are pinned to another address (see Alerts); changing this email moves only the ones that use it.</p>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <button type="button" className="text-primary underline" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                        {companyCounts[c.id] || 0}
                      </button>
                      {open === c.id && (
                        <ul className="mt-1 text-xs text-muted-foreground max-h-48 overflow-y-auto">
                          {(companyNames[c.id] || []).map((n) => <li key={n}>{n}</li>)}
                          {!(companyNames[c.id] || []).length && <li>No companies assigned.</li>}
                        </ul>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-xs">
                      {(alertsFor[c.id] || []).length === 0 ? <span className="text-muted-foreground">none</span> : (alertsFor[c.id] || []).map((a) => (
                        <div key={a.id}>{a.alert_type === "new_vacancy" ? "New roles" : a.alert_type}{a.enabled === false ? " (off)" : ""}{a.email && c.email && a.email.toLowerCase() !== c.email.toLowerCase() ? ` to ${a.email}` : ""}{(a.extra_recipients || []).length ? ` +${(a.extra_recipients || []).join(", ")}` : ""}</div>
                      ))}
                    </td>
                    <td className="py-2 pr-4"><Switch checked={c.active} onCheckedChange={(v) => void update(c, { active: v })} aria-label={`${c.name} active`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
