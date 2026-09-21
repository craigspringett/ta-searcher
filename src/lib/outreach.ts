/** The request send-outreach-email takes (the call itself is in outreachData.ts, so this file stays pure and testable). */
export interface OutreachRequest {
  companySearchId: string;
  contactName: string;
  contactRole?: string | null;
  contactEmail: string;
  subject: string;
  body: string;
  phone?: string;
  sendAnyway?: boolean;
  dryRun?: boolean;
}

export interface OutreachReply {
  ok?: boolean;
  dryRun?: boolean;
  html?: string;
  subject?: string;
  from?: string;
  fromApplied?: boolean;
  fromReason?: string | null;
  replyTo?: string;
  messageId?: string;
  message?: string;
  error?: string;
  code?: "blocked" | "warnings" | "suppressed" | "one_a_day" | "not_a_contact";
  blocked?: string[];
  warnings?: string[];
}

const PHONE_KEY = "ta-searcher.outreach.phone";

/** The phone number for the signature, remembered in this browser. */
export function rememberedPhone(): string {
  try { return localStorage.getItem(PHONE_KEY) || ""; } catch { return ""; }
}
export function rememberPhone(v: string): void {
  try { localStorage.setItem(PHONE_KEY, v.trim()); } catch { /* private window */ }
}

/** "Dear Mrs Patel," from "Mrs Patel", "Dear Sam," from "Sam Jones", "Hello," when there is no name. */
export function greeting(name: string | null | undefined): string {
  const n = (name || "").trim();
  if (!n) return "Hello,";
  const parts = n.split(/\s+/);
  const title = /^(mr|mrs|ms|miss|dr|prof|professor|rev|sir|dame)\.?$/i.test(parts[0]);
  if (title && parts.length >= 2) return `Dear ${parts[0]} ${parts[parts.length - 1]},`;
  return `Dear ${parts[0]},`;
}
