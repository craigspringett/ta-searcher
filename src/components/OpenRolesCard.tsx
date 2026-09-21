import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatIsoDateUk } from "@/lib/format";
import { countTalentRoles } from "@/lib/patch";
import { familyLabel, familyOf, ROLE_FAMILY_LABELS, ROLE_FAMILY_ORDER, sourceLabel, workplaceLabel, type RoleFamily } from "@/lib/roleFamily";
import type { AtsBoard, OpenRole } from "@/lib/analysis";

interface Props {
  roles: OpenRole[];
  boards?: AtsBoard[] | null;
  run?: { at?: string; degraded?: boolean; degradedReason?: string | null; sourcesOk?: string[] } | null;
}

const BOARD_NAMES: Record<AtsBoard["provider"], string> = { ashby: "Ashby", greenhouse: "Greenhouse", lever: "Lever", workable: "Workable" };

/** Newest first: by first seen, then the posting date, then the title. */
function newestFirst(a: OpenRole, b: OpenRole): number {
  const x = a.firstSeen || a.datePosted || "";
  const y = b.firstSeen || b.datePosted || "";
  return x < y ? 1 : x > y ? -1 : a.title.localeCompare(b.title);
}

/** One open role: title, source, department, location, workplace type, family, first seen. A talent role is picked out. */
export function OpenRoleRow({ role, showFamily = true, children }: { role: OpenRole; showFamily?: boolean; children?: React.ReactNode }) {
  const talent = familyOf(role.family) === "people_talent";
  const details = [role.department, role.location, workplaceLabel(role.workplaceType)].filter((x): x is string => !!x && x.trim().length > 0);
  return (
    <li className={`rounded-md border p-2.5 text-sm ${talent ? "border-warning/60 bg-warning/10" : "border-border/50 bg-muted/30"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {role.url && /^https?:/.test(role.url) ? (
          <a href={role.url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline inline-flex items-center gap-1">{role.title}<ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden="true" /></a>
        ) : (
          <span className="font-medium text-foreground">{role.title}</span>
        )}
        {talent && <Badge variant="outline" className="border-warning/60 text-warning text-[10px] py-0 px-1.5 h-5">Talent role</Badge>}
        {showFamily && !talent && <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-5">{familyLabel(role.family)}</Badge>}
        {(role.source || role.sourceLabel) && <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-5">{sourceLabel(role.source, role.sourceLabel)}</Badge>}
        {children}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {details.join(" · ")}
        {details.length > 0 && (role.firstSeen || role.datePosted) ? " · " : ""}
        {role.firstSeen ? `first seen ${formatIsoDateUk(role.firstSeen)}` : role.datePosted ? `posted ${formatIsoDateUk(role.datePosted)}` : ""}
      </p>
    </li>
  );
}

/**
 * "Open roles": every live role from the confirmed feeds and the careers
 * page, grouped by family (people and talent first) or newest first. The
 * talent roles, the direct lead, are picked out in the warning colour.
 */
export function OpenRolesCard({ roles, boards, run }: Props) {
  const [view, setView] = useState<"family" | "newest">("family");
  const talent = countTalentRoles(roles);
  const grouped = useMemo(() => {
    const map = new Map<RoleFamily, OpenRole[]>();
    for (const r of roles) (map.get(familyOf(r.family)) ?? map.set(familyOf(r.family), []).get(familyOf(r.family))!).push(r);
    return ROLE_FAMILY_ORDER.filter((f) => map.has(f)).map((f) => ({ family: f, roles: [...map.get(f)!].sort(newestFirst) }));
  }, [roles]);
  const newest = useMemo(() => [...roles].sort(newestFirst), [roles]);
  return (
    <Card className="p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-foreground">Open roles</h3>
        {roles.length > 1 && (
          <div className="flex gap-1 text-xs" role="group" aria-label="Order the roles">
            <button type="button" className={`rounded px-2 py-1 ${view === "family" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`} onClick={() => setView("family")} aria-pressed={view === "family"}>By family</button>
            <button type="button" className={`rounded px-2 py-1 ${view === "newest" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`} onClick={() => setView("newest")} aria-pressed={view === "newest"}>Newest first</button>
          </div>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {roles.length === 0 ? "No open roles found." : `${roles.length} open role${roles.length === 1 ? "" : "s"}${talent ? `, ${talent} in people and talent` : ", none in people and talent"}.`}
        {boards && boards.length > 0 && <> Feeds read: {boards.map((b) => `${BOARD_NAMES[b.provider] || b.provider} (${b.slug})`).join(", ")}.</>}
        {run?.degraded && <span className="text-warning"> The last read was degraded{run.degradedReason ? `: ${run.degradedReason}` : ""}; roles that vanished were not closed.</span>}
      </p>
      {roles.length > 0 && view === "family" && (
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.family}>
              <h4 className={`mb-1.5 text-sm font-semibold ${g.family === "people_talent" ? "text-warning" : "text-foreground"}`}>{ROLE_FAMILY_LABELS[g.family]} <span className="font-normal text-muted-foreground">({g.roles.length})</span></h4>
              <ul className="space-y-1.5">{g.roles.map((r, i) => <OpenRoleRow key={r.vacancyId || `${r.title}-${i}`} role={r} showFamily={false} />)}</ul>
            </div>
          ))}
        </div>
      )}
      {roles.length > 0 && view === "newest" && (
        <ul className="space-y-1.5">{newest.map((r, i) => <OpenRoleRow key={r.vacancyId || `${r.title}-${i}`} role={r} />)}</ul>
      )}
    </Card>
  );
}
