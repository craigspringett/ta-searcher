import type { ReactNode } from "react";
import { Pencil, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OfficersList } from "@/components/OfficersList";
import type { ContactEditMode } from "@/components/ContactEditDialog";
import { editTag, shortUkDate, type MergedContact, type RemovedContact } from "@/lib/contacts";
import type { DecisionMaker, Officer } from "@/lib/analysis";

export type ContactFeedbackKind = "bounced" | "wrong_person" | "left";

/** "provided by Alexa, September 2026" for a contact typed in from a consultant's list. */
function providedLabel(p: { provided_by?: string; provided_at?: string }): string {
  const when = p.provided_at ? new Date(p.provided_at + (p.provided_at.length === 10 ? "T00:00:00Z" : "")) : null;
  const month = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : null;
  return `provided by ${p.provided_by || "a consultant"}${month ? `, ${month}` : ""}`;
}

interface Props {
  /** null until the company is in the list (a brand-new analysis not yet saved): editing and reporting need the row. */
  companyId: string | null;
  officers: Officer[] | null | undefined;
  contacts: Array<MergedContact<DecisionMaker>>;
  removed: Array<RemovedContact<DecisionMaker>>;
  pagesRead?: number | null;
  editsError?: string | null;
  onEdit: (mode: ContactEditMode) => void;
  onReport: (person: MergedContact<DecisionMaker>, kind: ContactFeedbackKind) => void;
  /** Extra lines under a contact: the opens-and-clicks line and the email and follow-up buttons (behind the follow_ups flag). */
  extra?: (person: MergedContact<DecisionMaker>) => ReactNode;
}

/**
 * "People": the officers from Companies House (names to ask for), then the
 * decision makers found on the website with the team's corrections laid
 * over them, each with its confidence tag, source page, evidence and the
 * "wrong or bounced" report.
 */
export function ContactsCard({ companyId, officers, contacts, removed, pagesRead, editsError, onEdit, onReport, extra }: Props) {
  return (
    <Card className="p-6 scroll-mt-14" id="people">
      <h3 className="text-lg font-bold text-foreground mb-3">People</h3>

      <h4 className="text-sm font-semibold text-foreground mb-1">From Companies House</h4>
      <OfficersList officers={officers} />

      <div className="mt-5 mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Decision makers</h4>
        {typeof pagesRead === "number" && pagesRead > 0 && <span className="text-xs text-muted-foreground">{pagesRead} pages read</span>}
      </div>
      {contacts.length === 0 && (
        <p className="text-sm text-muted-foreground">No named decision makers were found on the company's website. The officers above are the names to ask for; phone the office, ask for the founders' EA, then add them here.</p>
      )}
      <div className="space-y-3">
        {contacts.map((person, idx) => {
          const label = person.edited ? editTag(person.edited) : person.confidence === "consultant_provided" ? providedLabel(person) : person.confidence === "found" ? "found on site" : person.confidence === "pattern_guess" ? (person.provided_by ? `pattern guess (${providedLabel(person)})` : "pattern guess") : person.confidence === "role_only" ? "name only" : "unverified";
          const labelClass = person.edited ? "bg-primary/10 text-primary" : person.confidence === "found" || person.confidence === "consultant_provided" ? "bg-positive/15 text-positive" : person.confidence === "pattern_guess" || !person.confidence ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground";
          const isPage = !!person.source_url && /^https?:/.test(person.source_url);
          const editNote = person.edited ? [person.edited.note, person.edited.from?.email && person.edited.from.email !== person.email ? `The website says ${person.edited.from.email}.` : null, person.edited.kind === "kept" ? "The website no longer lists this person; the edit is kept." : null].filter(Boolean).join(" ") : "";
          return (
            <div key={person.contactKey || idx} className={`p-3 bg-muted/30 rounded-lg border border-border/50 ${person.feedback ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    {person.name || <span className="text-muted-foreground font-normal">No name</span>}
                    {person.level === "careers" && <span className="ml-2 text-xs font-normal text-muted-foreground">careers site</span>}
                    {companyId && (
                      <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground" aria-label={`Edit ${person.name || "this contact"}`} title="Edit this contact" onClick={() => onEdit({ kind: "edit", contact: person })}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{person.role}</p>
                  {person.email ? (
                    <a href={`mailto:${person.email}`} className="text-sm text-primary hover:underline break-all">{person.email}</a>
                  ) : (
                    <span className="text-sm text-muted-foreground">No email on the site. Phone the office and ask by name.</span>
                  )}
                  {person.phone && <p className="text-sm text-muted-foreground">{person.phone}</p>}
                  {extra ? extra(person) : null}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {label && (person.edited && editNote ? (
                    <Tooltip>
                      <TooltipTrigger asChild><span tabIndex={0} className={`text-xs px-2 py-0.5 rounded cursor-help ${labelClass}`}>{label}</span></TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs text-xs">{editNote}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded ${labelClass}`}>{label}</span>
                  ))}
                  {isPage && <a href={person.source_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">source page</a>}
                  {person.source_url && !isPage && <span className="text-xs text-muted-foreground">{person.source_url}</span>}
                </div>
              </div>
              {person.evidence && (
                <details className="mt-1">
                  <summary className="text-xs text-muted-foreground cursor-pointer">evidence</summary>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{person.evidence}</p>
                </details>
              )}
              <div className="mt-2">
                {person.feedback ? (
                  <span className="text-xs text-muted-foreground">Reported: {person.feedback === "wrong_person" ? "wrong person" : person.feedback === "left" ? "has left" : "bounced"}</span>
                ) : (
                  <select
                    className="text-xs bg-transparent border border-border/50 rounded px-1 py-0.5 text-muted-foreground"
                    defaultValue=""
                    aria-label={`Report ${person.name || "this contact"}`}
                    onChange={(e) => {
                      const v = e.target.value as ContactFeedbackKind | "";
                      e.target.value = "";
                      if (v) onReport(person, v);
                    }}
                  >
                    <option value="">Wrong or bounced…</option>
                    <option value="bounced">Email bounced</option>
                    <option value="wrong_person">Wrong person</option>
                    <option value="left">Has left the company</option>
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {companyId && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onEdit({ kind: "add" })}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />Add a contact
          </Button>
          {editsError && <span className="text-xs text-critical">Could not load the team's edits: {editsError}</span>}
        </div>
      )}
      {removed.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-muted-foreground cursor-pointer">{removed.length === 1 ? "1 contact removed" : `${removed.length} contacts removed`}</summary>
          <ul className="mt-2 space-y-1">
            {removed.map((r) => (
              <li key={r.contactKey} className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span className="text-foreground">{r.name}{r.role ? `, ${r.role}` : ""}</span>
                <span>removed by {r.by}, {shortUkDate(r.at)}{r.reason ? `: ${r.reason}` : ""}</span>
                {companyId && <button type="button" className="text-primary hover:underline" onClick={() => onEdit({ kind: "restore", removed: r })}>Put back</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
