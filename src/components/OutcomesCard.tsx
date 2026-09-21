import { useEffect, useState, type FormEvent } from "react";
import { Loader2, PhoneCall, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { OUTCOME_LABELS } from "@/lib/patch";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Outcome = Tables<"outcomes">;

interface Props {
  companyId: string;
  contacts: Array<{ name: string; role?: string }>;
  /** Called after a change so the parent can refresh anything that shows the last outcome. */
  onChange?: () => void;
}

/** "Log a call" and the history of calls at this company. The Bullhorn seam later. */
export function OutcomesCard({ companyId, contacts, onChange }: Props) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Outcome[] | null>(null);
  const [kind, setKind] = useState("spoke_to");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("outcomes").select("*").eq("company_search_id", companyId).order("created_at", { ascending: false }).limit(50);
    if (error) { toast({ title: "Could not load call history", description: error.message, variant: "destructive" }); return; }
    setRows(data || []);
  };
  useEffect(() => { setRows(null); void load(); }, [companyId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (kind === "callback" && !callbackAt) { toast({ title: "When should they be called back?", variant: "destructive" }); return; }
    setSaving(true);
    const chosen = contacts.find((c) => c.name === contact);
    const { error } = await supabase.from("outcomes").insert({
      company_search_id: companyId,
      consultant_id: profile?.consultant_id ?? null,
      created_by: user.id,
      contact_name: contact || null,
      contact_role: chosen?.role || null,
      kind,
      note: note.trim() || null,
      callback_at: kind === "callback" && callbackAt ? new Date(callbackAt).toISOString() : null,
    });
    setSaving(false);
    if (error) { toast({ title: "Could not log the call", description: error.message, variant: "destructive" }); return; }
    setNote(""); setCallbackAt("");
    toast({ title: "Call logged" });
    await load();
    onChange?.();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("outcomes").delete().eq("id", id);
    if (error) { toast({ title: "Could not delete", description: error.message, variant: "destructive" }); return; }
    await load();
    onChange?.();
  };

  return (
    <Card className="p-6" id="calls">
      <h3 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2"><PhoneCall className="h-5 w-5 text-primary" aria-hidden="true" />Calls</h3>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="outcome-kind">Outcome</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger id="outcome-kind"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(OUTCOME_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="outcome-contact">Who</Label>
          {contacts.length > 0 ? (
            <Select value={contact || "none"} onValueChange={(v) => setContact(v === "none" ? "" : v)}>
              <SelectTrigger id="outcome-contact"><SelectValue placeholder="Contact" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not recorded</SelectItem>
                {contacts.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}{c.role ? ` (${c.role})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input id="outcome-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Name" />
          )}
        </div>
        {kind === "callback" && (
          <div>
            <Label htmlFor="outcome-callback">Call back on</Label>
            <Input id="outcome-callback" type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} required />
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="outcome-note">Note</Label>
          <Textarea id="outcome-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was said, what to do next" />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Log a call</Button>
        </div>
      </form>

      <div className="mt-4">
        {rows === null && <p className="text-xs text-muted-foreground" role="status">Loading history…</p>}
        {rows && rows.length === 0 && <p className="text-xs text-muted-foreground">No calls logged yet.</p>}
        {rows && rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-2 text-sm">
                <div>
                  <span className="font-medium">{OUTCOME_LABELS[o.kind] || o.kind}</span>
                  {o.contact_name && <span className="text-muted-foreground"> · {o.contact_name}{o.contact_role ? `, ${o.contact_role}` : ""}</span>}
                  <span className="text-muted-foreground"> · {new Date(o.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  {o.callback_at && <span className="block text-xs text-primary">Call back {new Date(o.callback_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                  {o.note && <p className="text-xs text-foreground/80 mt-1 whitespace-pre-wrap">{o.note}</p>}
                </div>
                {(o.created_by === user?.id || profile?.role !== "consultant") && (
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => void remove(o.id)} aria-label="Delete this call"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
