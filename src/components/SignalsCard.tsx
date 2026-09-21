import { useState } from "react";
import { Card } from "@/components/ui/card";

export interface SignalEvidence {
  type: "fact" | "vacancy" | "register" | "contact" | "data";
  id?: string;
  text: string;
  quote?: string;
  source_url?: string;
}

export interface Signal {
  code: string;
  label: string;
  strength: 1 | 2 | 3;
  evidence: SignalEvidence[];
  explanation: string;
}

const Dots = ({ n }: { n: number }) => (
  <span className="inline-flex gap-0.5 shrink-0" aria-label={`strength ${n} of 3`}>
    {[1, 2, 3].map((i) => (
      <span key={i} className={`inline-block h-2 w-2 rounded-full ${i <= n ? "bg-primary" : "bg-muted-foreground/25"}`} />
    ))}
  </span>
);

/**
 * The computed buyer-intent signals: label, strength as dots, a one-line
 * explanation and the evidence behind it, with the source quote and a link
 * to the page it was read from.
 */
export function SignalsCard({ signals, computedAt }: { signals: Signal[]; computedAt?: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-foreground">Buyer intent signals</h3>
        {computedAt && <span className="text-xs text-muted-foreground">computed {new Date(computedAt).toLocaleDateString("en-GB")}</span>}
      </div>
      {signals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No signal today: no open role, no raise or leadership change on the website or the register, and nothing from the team. The script says so honestly.</p>
      ) : (
        <ul className="space-y-2">
          {signals.map((s) => (
            <li key={s.code} className="rounded-lg border border-border/50 bg-muted/30 p-3">
              <button type="button" className="w-full text-left" onClick={() => setOpen(open === s.code ? null : s.code)}>
                <div className="flex items-center gap-2">
                  <Dots n={s.strength} />
                  <span className="font-semibold text-sm text-foreground">{s.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{open === s.code ? "hide evidence" : `${s.evidence.length} evidence`}</span>
                </div>
                <p className="text-sm text-foreground mt-1">{s.explanation}</p>
              </button>
              {open === s.code && (
                <ul className="mt-2 space-y-1.5 border-t border-border/50 pt-2">
                  {s.evidence.map((e, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      <span>{e.text}</span>
                      {e.quote && <blockquote className="mt-0.5 border-l-2 border-primary/40 pl-2 italic text-foreground/80">“{e.quote}”</blockquote>}
                      {e.source_url && /^https?:/.test(e.source_url) && (
                        <a href={e.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{e.source_url}</a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
