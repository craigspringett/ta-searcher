import { useEffect, useState } from "react";
import { Loader2, Pencil, UserPlus, UserX } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { isEmailAddress, type ContactLike, type MergedContact, type RemovedContact } from "@/lib/contacts";
import { callContactEdits, companyContactEditsKey, type ContactEditsReply } from "@/lib/contactEditsData";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** What the dialog is for: correcting a listed person, adding one, or putting a removed one back. */
export type ContactEditMode =
  | { kind: "edit"; contact: MergedContact<ContactLike> }
  | { kind: "add" }
  | { kind: "restore"; removed: RemovedContact<ContactLike> };

interface Props {
  companyId: string;
  companyName: string;
  mode: ContactEditMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a save, with the function's reply, so the page can refresh what it shows. */
  onSaved?: (reply: ContactEditsReply) => void;
}

/**
 * The contact dialog (Contact edits, 18 September 2026): name, role, email,
 * phone and a note. Save writes an "edit" or "add" row; "Remove this
 * contact" asks why and writes a "remove". The list updates at once. An
 * address on the do-not-email list is flagged as you type and can still
 * be saved (the send path refuses it).
 */
export function ContactEditDialog({ companyId, companyName, mode, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [suppressed, setSuppressed] = useState<string | null>(null);

  const editing = mode.kind === "edit" ? mode.contact : null;
  const restoring = mode.kind === "restore" ? mode.removed : null;
  const contactKey = editing?.contactKey ?? restoring?.contactKey ?? null;
  const original = editing?.edited?.from ?? null;

  useEffect(() => {
    if (!open) return;
    setName((editing?.name ?? restoring?.name ?? "") || "");
    setRole((editing?.role ?? restoring?.role ?? "") || "");
    setEmail((editing?.email ?? restoring?.email ?? "") || "");
    setPhone((editing?.phone ?? "") || "");
    setNote("");
    setRemoving(false);
    setReason("");
    setBusy(null);
    setProblem(null);
    setSuppressed(null);
  }, [open, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Is the address on the do-not-email list? Asked as they type, once it looks like an address.
  useEffect(() => {
    if (!open) return;
    const address = email.trim().toLowerCase();
    if (!isEmailAddress(address)) { setSuppressed(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      callContactEdits({ action: "check", email: address })
        .then(({ data }) => { if (!cancelled) setSuppressed(data.suppressed || null); })
        .catch(() => { if (!cancelled) setSuppressed(null); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, email]);

  const finish = (data: ContactEditsReply) => {
    toast({ title: data.message || "Saved", description: [data.sequenceUpdated?.note, data.warning, data.suppressed].filter(Boolean).join(" ") || undefined });
    void queryClient.invalidateQueries({ queryKey: companyContactEditsKey(companyId) });
    void queryClient.invalidateQueries({ queryKey: ["follow-ups", companyId] });
    void queryClient.invalidateQueries({ queryKey: ["follow-ups-active"] });
    onSaved?.(data);
    onOpenChange(false);
  };

  const save = async () => {
    setProblem(null);
    const address = email.trim().toLowerCase();
    if (!name.trim()) { setProblem("A name is needed."); return; }
    if (address && !isEmailAddress(address)) { setProblem("That does not look like an email address. Check it: name@company.sch.uk."); return; }
    setBusy("save");
    try {
      const { status, data } = await callContactEdits({
        action: mode.kind === "add" ? "add" : "edit",
        companySearchId: companyId,
        ...(contactKey ? { contactKey } : {}),
        name: name.trim(),
        role: role.trim() || null,
        email: address || null,
        phone: phone.trim() || null,
        note: note.trim() || null,
      });
      if (status >= 400) { setProblem(data.error || `HTTP ${status}`); return; }
      finish(data);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setProblem(null);
    if (!reason.trim()) { setProblem("Say why, in a few words, so the team knows."); return; }
    if (!contactKey) return;
    setBusy("remove");
    try {
      const { status, data } = await callContactEdits({ action: "remove", companySearchId: companyId, contactKey, name: name.trim() || editing?.name || "", note: reason.trim() });
      if (status >= 400) { setProblem(data.error || `HTTP ${status}`); return; }
      finish(data);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const title = mode.kind === "add" ? "Add a contact" : mode.kind === "restore" ? `Put ${restoring?.name || "this contact"} back` : `Edit ${editing?.name || "this contact"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode.kind === "add" ? <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" /> : <Pencil className="h-5 w-5 text-primary" aria-hidden="true" />}{title}
          </DialogTitle>
          <DialogDescription>
            {mode.kind === "add"
              ? `Someone at ${companyName} the website did not name. They will show as added by you, and the weekly refresh keeps them.`
              : mode.kind === "restore"
                ? `${restoring?.name || "This contact"} was removed by ${restoring?.by}${restoring?.reason ? ` (${restoring.reason})` : ""}. Saving puts them back on the list.`
                : `What you save here replaces what the website says, shows as edited by you, and is what gets emailed. The weekly refresh keeps it.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="contact-name">Name</Label>
              <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mrs H Patel" maxLength={200} autoFocus />
            </div>
            <div>
              <Label htmlFor="contact-role">Role</Label>
              <Input id="contact-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Headteacher" maxLength={120} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="contact-email">Email</Label>
              <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="head@company.sch.uk" maxLength={200} />
              {original?.email && original.email.toLowerCase() !== email.trim().toLowerCase() && <p className="mt-1 text-xs text-muted-foreground">The website says {original.email}.</p>}
              {suppressed && <p className="mt-1 text-xs text-warning" role="note">{suppressed}</p>}
            </div>
            <div>
              <Label htmlFor="contact-phone">Phone</Label>
              <Input id="contact-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="020 7946 0000" maxLength={40} />
            </div>
          </div>
          <div>
            <Label htmlFor="contact-note">Note</Label>
            <Input id="contact-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="from the company office, 18 Sep" maxLength={500} />
            <p className="mt-1 text-xs text-muted-foreground">Where the details came from. Shown when someone hovers over the tag.</p>
          </div>

          {problem && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-foreground" role="alert">{problem}</p>}

          {removing ? (
            <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
              <Label htmlFor="contact-reason">Why remove {editing?.name || "this contact"}?</Label>
              <Textarea id="contact-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Has left the company; the office said to ask for the deputy" maxLength={500} />
              <p className="mt-1 text-xs text-muted-foreground">They come off the list for everyone. A manager can put them back from the removed list under the contacts.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="destructive" onClick={() => void remove()} disabled={!!busy} className="gap-2">
                  {busy === "remove" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Remove
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(false)} disabled={!!busy}>Keep them</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => void save()} disabled={!!busy} className="gap-2">
                {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{mode.kind === "add" ? "Add" : "Save"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={!!busy}>Cancel</Button>
              {mode.kind === "edit" && (
                <Button type="button" variant="ghost" size="sm" className="ml-auto gap-1.5 text-muted-foreground" onClick={() => setRemoving(true)} disabled={!!busy}>
                  <UserX className="h-4 w-4" aria-hidden="true" />Remove this contact
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
