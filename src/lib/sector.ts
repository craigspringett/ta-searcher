/**
 * A short sector label from a company's SIC codes, the same table as
 * `supabase/functions/_shared/companies-house.ts` `sectorFromSic` (change
 * both). Codes arrive from Companies House as five digits ("62012"); the
 * table matches the most specific rule first (58.29, 70.22, 47.91), then the
 * two-digit division. The first code with a label wins; null when none has
 * one.
 */

const FOUR_DIGIT: ReadonlyArray<readonly [string, string]> = [
  ["5829", "Software"],
  ["7022", "Consultancy"],
  ["4791", "Online retail"],
];

const TWO_DIGIT: Readonly<Record<string, string>> = {
  "62": "Software",
  "63": "Data and platforms",
  "64": "Financial services",
  "66": "Financial services",
  "72": "Research and development",
  "86": "Health",
  "21": "Biotech",
  "73": "Marketing",
  "82": "Business services",
  "85": "Education",
  "35": "Energy",
  "71": "Engineering",
  "74": "Design and professional services",
};

export function sectorFromSic(codes: ReadonlyArray<string | null | undefined> | null | undefined): string | null {
  for (const raw of codes || []) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (digits.length < 2) continue;
    const specific = FOUR_DIGIT.find(([prefix]) => digits.startsWith(prefix));
    if (specific) return specific[1];
    const division = TWO_DIGIT[digits.slice(0, 2)];
    if (division) return division;
  }
  return null;
}
