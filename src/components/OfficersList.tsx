import { formatLongDate } from "@/lib/patch";
import type { Officer } from "@/lib/analysis";

const ROLE_LABELS: Record<string, string> = {
  director: "Director",
  secretary: "Secretary",
  "llp-member": "LLP member",
  "llp-designated-member": "LLP designated member",
  "corporate-director": "Corporate director",
  "corporate-secretary": "Corporate secretary",
};

function roleLabel(role: string): string {
  const key = role.toLowerCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  return key.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** True when the appointment is within the last six months: the "New senior officer" signal's window. */
function recent(iso: string | null, months = 6): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return d >= cutoff;
}

/**
 * The officers Companies House lists: current appointments first, newest
 * appointment at the top, resigned ones folded away. Directors are usually
 * the founders; the register never gives an address, so these are names to
 * ask for, not people to email.
 */
export function OfficersList({ officers }: { officers: Officer[] | null | undefined }) {
  const list = officers || [];
  if (list.length === 0) return <p className="text-xs text-muted-foreground">No officers on the register for this company (no company number, or the register has not been read yet).</p>;
  const byDate = (a: Officer, b: Officer) => (b.appointedOn || "") < (a.appointedOn || "") ? -1 : (b.appointedOn || "") > (a.appointedOn || "") ? 1 : a.name.localeCompare(b.name);
  const current = list.filter((o) => !o.resignedOn).sort(byDate);
  const resigned = list.filter((o) => !!o.resignedOn).sort((a, b) => ((b.resignedOn || "") < (a.resignedOn || "") ? -1 : 1));
  const Row = ({ o }: { o: Officer }) => (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 py-1 text-sm">
      <span className="text-foreground">{o.name} <span className="text-muted-foreground">· {roleLabel(o.role)}</span></span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {o.appointedOn ? `appointed ${formatLongDate(o.appointedOn)}` : "appointment date not given"}
        {o.resignedOn ? `, resigned ${formatLongDate(o.resignedOn)}` : ""}
        {!o.resignedOn && recent(o.appointedOn) && <span className="ml-1 rounded bg-warning/15 px-1 py-0.5 text-[10px] text-warning">new</span>}
      </span>
    </li>
  );
  return (
    <div>
      {current.length === 0 ? <p className="text-xs text-muted-foreground">No current officers.</p> : <ul className="divide-y divide-border/60">{current.map((o) => <Row key={`${o.officerId || o.name}-${o.appointedOn}`} o={o} />)}</ul>}
      {resigned.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">{resigned.length === 1 ? "1 resigned officer" : `${resigned.length} resigned officers`}</summary>
          <ul className="mt-1 divide-y divide-border/60 opacity-75">{resigned.map((o) => <Row key={`${o.officerId || o.name}-${o.resignedOn}`} o={o} />)}</ul>
        </details>
      )}
    </div>
  );
}
