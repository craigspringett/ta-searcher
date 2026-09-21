import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OpenRoleRow } from "@/components/OpenRolesCard";
import { familyOf, ROLE_FAMILY_LABELS, ROLE_FAMILY_ORDER, sourceLabel, workplaceLabel } from "@/lib/roleFamily";
import type { OpenRole } from "@/lib/analysis";

/** One open role with the company it belongs to, for the portfolio-wide list. */
export interface PortfolioRole {
  companyId: string;
  companyName: string;
  consultants: string;
  role: OpenRole;
  /** When the company was last refreshed (ms), the fallback when a role carries no first-seen date. */
  refreshedAt: number;
}

function seenAt(r: PortfolioRole): number {
  const iso = r.role.firstSeen || r.role.datePosted;
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? r.refreshedAt : t;
}

function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/**
 * "All roles": every open role across the tracked companies, filtered by
 * family, source, company and when it was first seen, newest first (start
 * dates do not exist for a start-up role, so there is no urgency ordering).
 */
export function AllRolesTab({ rows, onOpenCompany }: { rows: PortfolioRole[]; onOpenCompany: (companyId: string) => void }) {
  const [family, setFamily] = useState("all");
  const [source, setSource] = useState("all");
  const [company, setCompany] = useState("all");
  const [when, setWhen] = useState("all");

  const sources = useMemo(() => Array.from(new Set(rows.map((r) => r.role.source).filter((x): x is string => !!x))).sort(), [rows]);
  const companies = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.companyId)) seen.set(r.companyId, r.companyName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const days = when === "week" ? 7 : when === "month" ? 30 : when === "two-months" ? 60 : null;
    return rows
      .filter((r) => family === "all" || familyOf(r.role.family) === family)
      .filter((r) => source === "all" || r.role.source === source)
      .filter((r) => company === "all" || r.companyId === company)
      .filter((r) => days === null || now - seenAt(r) <= days * 86400000)
      .sort((a, b) => seenAt(b) - seenAt(a) || a.role.title.localeCompare(b.role.title));
  }, [rows, family, source, company, when]);

  const exportCsv = () => {
    const headers = ["Company", "Consultant", "Role", "Family", "Source", "Department", "Location", "Workplace", "First seen", "URL"];
    const lines = filtered.map((r) => [r.companyName, r.consultants, r.role.title, ROLE_FAMILY_LABELS[familyOf(r.role.family)], sourceLabel(r.role.source, r.role.sourceLabel), r.role.department || "", r.role.location || "", workplaceLabel(r.role.workplaceType), r.role.firstSeen || r.role.datePosted || "", r.role.url || ""]);
    const csv = [headers, ...lines].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `open-roles-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const talentCount = rows.filter((r) => familyOf(r.role.family) === "people_talent").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={family} onValueChange={setFamily}>
            <SelectTrigger className="w-[190px] h-9" aria-label="Family"><SelectValue placeholder="Family" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All families</SelectItem>
              {ROLE_FAMILY_ORDER.map((f) => <SelectItem key={f} value={f}>{ROLE_FAMILY_LABELS[f]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-[160px] h-9" aria-label="Source"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((s) => <SelectItem key={s} value={s}>{sourceLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={company} onValueChange={setCompany}>
            <SelectTrigger className="w-[260px] h-9" aria-label="Company"><SelectValue placeholder="Company" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={when} onValueChange={setWhen}>
            <SelectTrigger className="w-[170px] h-9" aria-label="First seen"><SelectValue placeholder="First seen" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any time</SelectItem>
              <SelectItem value="week">Last week</SelectItem>
              <SelectItem value="month">Last month</SelectItem>
              <SelectItem value="two-months">Last two months</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            Showing {filtered.length} of {rows.length} roles{talentCount ? <span className="text-warning"> · {talentCount} in people and talent</span> : ""}
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} className="h-8" disabled={filtered.length === 0}>
            <Download className="h-3 w-3 mr-1" aria-hidden="true" />CSV
          </Button>
        </div>
      </div>

      {filtered.length > 0 ? (
        <ul className="grid gap-2">
          {filtered.map((r, i) => (
            <OpenRoleRow key={`${r.companyId}-${r.role.vacancyId || r.role.title}-${i}`} role={r.role}>
              <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={() => onOpenCompany(r.companyId)}>
                {r.companyName}{r.consultants ? <span className="text-muted-foreground"> · {r.consultants}</span> : ""}
              </button>
            </OpenRoleRow>
          ))}
        </ul>
      ) : (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No roles match the filters.</p>
        </Card>
      )}
    </div>
  );
}
