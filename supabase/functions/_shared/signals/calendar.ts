// Date arithmetic for the signal rules. A start-up has no term calendar and
// no resignation deadlines (docs/TA-SEARCHER-BRIEF.md, the mapping), so
// this is only the helpers the rules and their wording share.

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

/** Whole calendar months from one ISO date to another (the day of the month ignored); negative when `toIso` is earlier. */
export function monthsBetween(fromIso: string, toIso: string): number {
  return (Number(toIso.slice(0, 4)) - Number(fromIso.slice(0, 4))) * 12 + (Number(toIso.slice(5, 7)) - Number(fromIso.slice(5, 7)));
}

/** "15 Jun 2026" from an ISO date, for the wording; the input comes back when it is not a date. */
export function describeDate(iso: string): string {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}
