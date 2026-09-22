import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Mail, RefreshCw, Unplug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { connectionLine, type ConnectionView } from "@/lib/inbox";
import { callMsConnect, toConnectionView } from "@/lib/inboxData";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

/**
 * Outlook inbox reading (22 September 2026): connect your Microsoft 365
 * mailbox so TA Searcher can spot a reply from a contact you emailed, stop
 * that follow-up run, log it as replied and draft an answer in your tone.
 * Read-only (Mail.Read); nothing is ever sent from the mailbox. The
 * ms-oauth-callback function lands back here with ?outlook=connected|error.
 */
export function OutlookCard() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [busy, setBusy] = useState<"start" | "check" | "disconnect" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await callMsConnect("status");
      if (r.error) throw new Error(r.error);
      setConfigured(!!r.configured);
      setConnection(toConnectionView(r.connection));
    } catch (e) {
      toast({ title: "Could not read the Outlook connection", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const outcome = params.get("outlook");
    if (!outcome) return;
    if (outcome === "connected") toast({ title: "Outlook connected", description: "TA Searcher now reads your inbox every fifteen minutes for replies from contacts on the patch." });
    else toast({ title: "Outlook not connected", description: params.get("reason") || "Microsoft did not complete the sign-in. Try Connect Outlook again.", variant: "destructive" });
    const next = new URLSearchParams(params);
    next.delete("outlook");
    next.delete("reason");
    setParams(next, { replace: true });
  }, [params, setParams, toast]);

  const start = async () => {
    setBusy("start");
    try {
      const r = await callMsConnect("start");
      if (r.error || !r.url) throw new Error(r.error || "No sign-in link came back.");
      window.location.assign(r.url);
    } catch (e) {
      toast({ title: "Could not start", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy("check");
    try {
      const r = await callMsConnect("check");
      if (r.error) throw new Error(r.error);
      toast({ title: r.ok ? "Inbox read" : "Could not read the inbox", description: r.message, variant: r.ok ? undefined : "destructive" });
      await load();
    } catch (e) {
      toast({ title: "Could not read the inbox", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      const r = await callMsConnect("disconnect");
      if (r.error) throw new Error(r.error);
      toast({ title: "Outlook disconnected", description: r.message });
      setConnection(null);
    } catch (e) {
      toast({ title: "Could not disconnect", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
      setConfirmOpen(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Outlook replies</h2>
          <p className="mt-1 text-sm text-muted-foreground">Connect your Microsoft 365 mailbox and TA Searcher reads it every fifteen minutes (read-only, nothing is sent). A reply from a contact you have emailed stops that follow-up run, goes in the company's history as replied, and gets a drafted answer in your tone on the company page and on My patch, ready to copy into Outlook.</p>
          <p className="mt-2 text-sm text-foreground" role="status">
            {loading ? <><Loader2 className="inline h-4 w-4 animate-spin mr-2" aria-hidden="true" />Checking…</> : connectionLine(connection, configured)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!loading && (!connection || connection.status === "needs_reconnect") && (
            <Button size="sm" onClick={() => void start()} disabled={!configured || !!busy} className="gap-2">
              {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}{connection ? "Connect again" : "Connect Outlook"}
            </Button>
          )}
          {!loading && connection && (
            <>
              <Button size="sm" variant="outline" onClick={() => void check()} disabled={!!busy} className="gap-2" title="Read the inbox now instead of waiting for the next quarter hour">
                {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}Check now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(true)} disabled={!!busy} className="gap-2">
                <Unplug className="h-4 w-4" aria-hidden="true" />Disconnect
              </Button>
            </>
          )}
        </div>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Outlook?</AlertDialogTitle>
            <AlertDialogDescription>TA Searcher stops reading your inbox and forgets its sign-in. Replies already spotted stay on the company pages. You can connect again at any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "disconnect"}>Keep it connected</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void disconnect(); }} disabled={busy === "disconnect"}>
              {busy === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : null}Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
