import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, Copy, Loader2, RefreshCw } from "lucide-react";

export type Persona = "founder" | "coo" | "people" | "cto" | "investor";
export const PERSONA_LABELS: Record<Persona, string> = {
  founder: "Founder / CEO",
  coo: "COO / Chief of Staff",
  people: "Head of People",
  cto: "CTO / VP Engineering",
  investor: "Investor talent partner",
};
export const PERSONAS: Persona[] = ["founder", "coo", "people", "cto", "investor"];

export interface PersonaCopy {
  call: { opener: string; discovery_questions: string[]; objections: Array<{ objection: string; response: string }>; voicemail: string; close: string };
  email: { subject: string; body: string; followup: string };
}

export interface StoredCopy {
  persona: Persona;
  copy: PersonaCopy;
  contact?: { name: string; role: string; email?: string; confidence?: string } | null;
  evidence_fingerprint?: string | null;
  quality_flags?: string[];
  model?: string;
  trigger?: string;
  generated_at?: string;
}

interface Props {
  copy: Partial<Record<Persona, StoredCopy>> | undefined;
  /** The investor persona is written only when an investor fact or contact exists; show its tab when it applies or has copy. */
  hasInvestor: boolean;
  currentFingerprint?: string | null;
  evidenceComputedAt?: string | null;
  regenerating: Persona | null;
  onRegenerate: (persona: Persona) => void;
  onCopy: (text: string, field: string) => void;
  copiedField: string | null;
}

function ageWords(iso?: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * The per-persona scripts: opener, questions, objections, voicemail, close
 * and the email, each with a copy button, plus Regenerate. Body font
 * throughout; nothing here is monospace.
 */
export function ScriptsCard(p: Props) {
  const personas = PERSONAS.filter((x) => x !== "investor" || p.hasInvestor || !!p.copy?.investor);
  const [tab, setTab] = useState<Persona>("founder");
  const CopyButton = ({ text, field }: { text: string; field: string }) => (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => p.onCopy(text, field)}>
      {p.copiedField === field ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" />Copy</>}
    </Button>
  );
  const Section = ({ title, text, field, children }: { title: string; text: string; field: string; children?: React.ReactNode }) => (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <CopyButton text={text} field={field} />
      </div>
      {children ?? <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{text}</p>}
    </div>
  );

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-foreground">Scripts</h3>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Persona)}>
        <TabsList className="flex flex-wrap h-auto">
          {personas.map((x) => (
            <TabsTrigger key={x} value={x} className="text-xs">{PERSONA_LABELS[x]}{p.copy?.[x] ? "" : " ·"}</TabsTrigger>
          ))}
        </TabsList>
        {personas.map((x) => {
          const stored = p.copy?.[x];
          const stale = stored && p.currentFingerprint && stored.evidence_fingerprint && stored.evidence_fingerprint !== p.currentFingerprint;
          const busy = p.regenerating === x;
          return (
            <TabsContent key={x} value={x} className="space-y-3 mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {stored ? (
                    <>
                      Written {ageWords(stored.generated_at)}{stored.contact?.name ? ` for ${stored.contact.name} (${stored.contact.role})` : ", no named contact"}.
                      {p.evidenceComputedAt && <> Evidence from {ageWords(p.evidenceComputedAt)}.</>}
                      {stale && <span className="ml-1 text-warning">The evidence has changed since; regenerate for the current version.</span>}
                      {(stored.quality_flags?.length || 0) > 0 && <span className="ml-1 text-warning">Check before use: {stored.quality_flags!.join("; ")}.</span>}
                    </>
                  ) : (
                    <>Not written yet{busy ? "" : "; it is generated in the background after an analysis, or press Regenerate"}.</>
                  )}
                </div>
                <Button variant="outline" size="sm" disabled={p.regenerating !== null} onClick={() => p.onRegenerate(x)}>
                  {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  {busy ? "Writing" : "Regenerate"}
                </Button>
              </div>
              {stored && (
                <>
                  <Section title="Call opener" text={stored.copy.call.opener} field={`${x}-opener`} />
                  <Section title="Discovery questions" text={stored.copy.call.discovery_questions.map((q) => `- ${q}`).join("\n")} field={`${x}-questions`}>
                    <ul className="list-disc pl-5 text-sm text-foreground space-y-1">{stored.copy.call.discovery_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
                  </Section>
                  <Section title="Objections" text={stored.copy.call.objections.map((o) => `"${o.objection}"\n${o.response}`).join("\n\n")} field={`${x}-objections`}>
                    <ul className="text-sm text-foreground space-y-2">
                      {stored.copy.call.objections.map((o, i) => (
                        <li key={i}><span className="font-medium">“{o.objection}”</span><br /><span className="text-foreground/90">{o.response}</span></li>
                      ))}
                    </ul>
                  </Section>
                  <Section title="Voicemail" text={stored.copy.call.voicemail} field={`${x}-voicemail`} />
                  <Section title="Close" text={stored.copy.call.close} field={`${x}-close`} />
                  <Section title="Email" text={`Subject: ${stored.copy.email.subject}\n\n${stored.copy.email.body}`} field={`${x}-email`}>
                    <p className="text-sm font-medium text-foreground mb-2">Subject: {stored.copy.email.subject}</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{stored.copy.email.body}</p>
                  </Section>
                  <Section title="Follow-up (five days later)" text={stored.copy.email.followup} field={`${x}-followup`} />
                </>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </Card>
  );
}
