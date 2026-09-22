import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SECTORS, STAGES, type Sector, type Stage } from "@/lib/prospects";

interface DigestSettings { enabled: boolean; sectors: Sector[]; stages: Stage[] }

function fromValue(value: Json | null | undefined): DigestSettings {
  const v = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Json | undefined>) : {};
  const sectors = Array.isArray(v.sectors) ? v.sectors.map(String).filter((x): x is Sector => (SECTORS as readonly string[]).includes(x)) : [];
  const stages = Array.isArray(v.stages) ? v.stages.map(String).filter((x): x is Stage => (STAGES as readonly string[]).includes(x)) : [];
  return { enabled: v.enabled !== false, sectors, stages };
}

/**
 * The Monday raises digest: on or off, which sectors and stages, and a
 * test send to yourself. Saved in app_settings.raises_digest; managers
 * change it, everyone sees it.
 */
export function RaisesDigestCard() {
  const { user, isManager } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<DigestSettings | null>(null);
  const [stored, setStored] = useState<Record<string, Json | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "raises_digest").maybeSingle();
      setSettings(fromValue(data?.value));
      setStored(data?.value && typeof data.value === "object" && !Array.isArray(data.value) ? (data.value as Record<string, Json | undefined>) : {});
    })();
  }, []);

  const save = async (next: DigestSettings) => {
    setSettings(next);
    if (!isManager) return;
    setSaving(true);
    const value: Json = { ...stored, enabled: next.enabled, sectors: next.sectors, stages: next.stages };
    const { error } = await supabase.from("app_settings").upsert({ key: "raises_digest", value, updated_by: user?.id ?? null });
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    setStored(value as Record<string, Json | undefined>);
  };

  const toggle = <T extends string>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const sendTest = async () => {
    if (!user?.email) return;
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-raises-digest", { body: { testEmail: user.email } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      toast({ title: "Test digest sent", description: data?.message || `Sent to ${user.email}.` });
    } catch (e) {
      toast({ title: "Test failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
    setTesting(false);
  };

  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"} ${isManager ? "" : "cursor-default"}`;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Weekly raises digest</h2>
          <p className="mt-1 text-sm text-muted-foreground">Every Monday at 08:00 UK time, one email with every raise the radar saw last week in the sectors and at the stages below, grouped by sector, with the headline and a link to the company. Nothing chosen means every sector, and every stage but Unknown.</p>
        </div>
        <div className="flex items-center gap-3">
          {settings && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={settings.enabled} onCheckedChange={(v) => void save({ ...settings, enabled: v })} disabled={!isManager || saving} aria-label="Send the weekly raises digest" />
              {settings.enabled ? "On" : "Off"}
            </label>
          )}
          <Button variant="outline" size="sm" onClick={() => void sendTest()} disabled={testing || !user?.email} className="h-8 gap-1.5 text-xs">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}Send me a test digest
          </Button>
        </div>
      </div>
      {settings ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Sectors</span>
            {SECTORS.map((sct) => (
              <button key={sct} type="button" aria-pressed={settings.sectors.includes(sct)} className={chip(settings.sectors.includes(sct))} onClick={() => isManager && void save({ ...settings, sectors: toggle(settings.sectors, sct) })}>{sct}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Stages</span>
            {STAGES.filter((st) => st !== "Unknown").map((st) => (
              <button key={st} type="button" aria-pressed={settings.stages.includes(st)} className={chip(settings.stages.includes(st))} onClick={() => isManager && void save({ ...settings, stages: toggle(settings.stages, st) })}>{st}</button>
            ))}
          </div>
          {!isManager && <p className="text-xs text-muted-foreground">Managers can change the sectors and stages.</p>}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground"><Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1" aria-hidden="true" />Loading…</p>
      )}
    </Card>
  );
}
