import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, MailOpen, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { FIRM_NAME } from "@/lib/brand";
import { clipboardText, rememberedPhone } from "@/lib/outreach";
import { replyRead, replyWho, type InboxReply } from "@/lib/inbox";
import { loadCompanyReplies, loadUnhandledReplies, markReplyHandled } from "@/lib/inboxData";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SourceNote } from "@/components/SourceNote";

const REPLIES_SOURCE = "Replies TA Searcher spotted in your connected Outlook inbox (Alerts page) from a contact you emailed, a stored contact or the company's own domain. Each stops the follow-up run, is logged as replied in the Calls history, and gets a drafted answer in your tone. Nothing is sent: copy the draft into Outlook, change what you like, and tick it as handled here.";

export const companyRepliesKey = (companyId: string) => ["inbox-replies", companyId] as const;
export const unhandledRepliesKey = ["inbox-replies", "unhandled"] as const;

function whenLine(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

/** One reply with its draft: copy for Outlook, mark handled, show the message. */
export function ReplyRow({ reply, companyName, showCompany, onChange }: { reply: InboxReply; companyName?: string; showCompany?: boolean; onChange: () => void }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const read = replyRead(reply.matchNote);
  const draft = !!reply.draftBody && !!reply.draftSubject;

  const copy = async () => {
    if (!draft) return;
    const text = clipboardText(reply.draftSubject!, reply.draftBody!, { name: profile?.display_name || profile?.email || "", firm: FIRM_NAME, phone: rememberedPhone() });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied", description: `Reply to ${reply.fromEmail} in Outlook (Reply on their message keeps the thread), paste this in, send it, then press Handled.` });
    } catch {
      toast({ title: "Could not copy", description: "Select the text and copy it by hand.", variant: "destructive" });
    }
  };

  const setHandled = async (handled: boolean) => {
    setBusy(true);
    try {
      await markReplyHandled(reply.id, handled);
      onChange();
    } catch (e) {
      toast({ title: "Not saved", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`py-3 space-y-2 ${reply.handledAt ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="font-medium text-foreground">
            {replyWho(reply)}
            {showCompany && reply.companyId && (
              <> at <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-primary" onClick={() => navigate(`/companies/${reply.companyId}`)}>{companyName}</button></>
            )}
            <span className="ml-2 font-normal text-muted-foreground">{whenLine(reply.receivedAt)}</span>
          </p>
          <p className="text-muted-foreground truncate">{reply.subject || "(no subject)"}{read ? ` · ${read}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {reply.bodyText && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowMessage((v) => !v)} className="gap-2">
              <MailOpen className="h-4 w-4" aria-hidden="true" />{showMessage ? "Hide their message" : "Their message"}
            </Button>
          )}
          {draft && !reply.handledAt && (
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()} className="gap-2" title="Copies the subject, the drafted reply and your signature to paste into Outlook">
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copied ? "Copied" : "Copy for Outlook"}
            </Button>
          )}
          {reply.handledAt ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => void setHandled(false)} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="h-4 w-4" aria-hidden="true" />}Not handled after all
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => void setHandled(true)} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}Handled
            </Button>
          )}
        </div>
      </div>
      {showMessage && reply.bodyText && (
        <blockquote className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground whitespace-pre-wrap">{reply.bodyText}</blockquote>
      )}
      {draft && !reply.handledAt && (
        <div className="rounded-md border border-border bg-background p-3 text-sm">
          <p className="font-medium text-foreground">Drafted reply: {reply.draftSubject}</p>
          <p className="mt-1 whitespace-pre-wrap text-foreground">{reply.draftBody}</p>
          {reply.draftFlags.length > 0 && <p className="mt-2 text-xs text-warning">Check before sending: {reply.draftFlags.join("; ")}.</p>}
        </div>
      )}
      {!draft && !reply.handledAt && (
        <p className="text-xs text-muted-foreground">{reply.draftError ? `No draft: ${reply.draftError}` : "No draft for this one; answer it from Outlook."}</p>
      )}
    </li>
  );
}

/** The company page's replies (Outlook inbox reading), newest first. */
export function RepliesCard({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: companyRepliesKey(companyId), queryFn: () => loadCompanyReplies(companyId) });
  const onChange = () => {
    void queryClient.invalidateQueries({ queryKey: companyRepliesKey(companyId) });
    void queryClient.invalidateQueries({ queryKey: unhandledRepliesKey });
  };
  if (!isLoading && !error && (data || []).length === 0) return null;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-foreground">Replies from Outlook</h3>
        <SourceNote text={REPLIES_SOURCE} />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Loading…</p>}
      {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
      {data && data.length > 0 && <ul className="divide-y divide-border/60">{data.map((r) => <ReplyRow key={r.id} reply={r} onChange={onChange} />)}</ul>}
    </Card>
  );
}

/** My patch: every reply not yet handled, across the patch, with the company named. */
export function RepliesDueCard() {
  const queryClient = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: unhandledRepliesKey, queryFn: loadUnhandledReplies });
  const onChange = () => { void queryClient.invalidateQueries({ queryKey: ["inbox-replies"] }); };
  if (!isLoading && !error && (data || []).length === 0) return null;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-foreground">Replies to answer</h3>
        <SourceNote text={REPLIES_SOURCE} />
      </div>
      {isLoading && <p className="text-sm text-muted-foreground" role="status"><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Loading…</p>}
      {error && <p className="text-sm text-destructive" role="alert">Could not load: {(error as Error).message}</p>}
      {data && data.length > 0 && <ul className="divide-y divide-border/60">{data.map((r) => <ReplyRow key={r.id} reply={r} companyName={r.companyName} showCompany onChange={onChange} />)}</ul>}
    </Card>
  );
}
