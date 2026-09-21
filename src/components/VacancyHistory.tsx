import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sourceLabel } from "@/lib/roleFamily";

interface Row { id: string; title: string; source: string; first_seen: string; last_seen: string; status: string }

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

/** What this company has advertised, from the vacancies table: first seen, last seen, closed. */
export function VacancyHistory({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    let active = true;
    setRows(null);
    supabase.from("vacancies").select("id, title, source, first_seen, last_seen, status").eq("company_search_id", companyId).neq("status", "rejected").order("first_seen", { ascending: false }).limit(40)
      .then(({ data, error }) => { if (active) setRows(error ? [] : ((data || []) as Row[])); });
    return () => { active = false; };
  }, [companyId]);
  if (rows === null) return <p className="text-xs text-muted-foreground" role="status">Loading role history…</p>;
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No roles recorded for this company since tracking began.</p>;
  const open = rows.filter((r) => r.status === "open").length;
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">{rows.length} role{rows.length === 1 ? "" : "s"} seen since tracking began, {open} open now.</p>
      <ul className="divide-y divide-border/60 text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className="truncate">{r.title} <span className="text-muted-foreground">· {sourceLabel(r.source)}</span></span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {fmt(r.first_seen)}{r.status === "open" ? ", open" : ` to ${fmt(r.last_seen)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
