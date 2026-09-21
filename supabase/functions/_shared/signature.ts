// The signature block on emails sent in a consultant's name (company
// outreach and follow-ups through send-outreach-email, CRM Shortlister
// candidate emails through send-shortlist-emails).
//
// Craig, 18 September 2026: the team's real signatures on the emails. The
// layout copies the Outlook signature Kim sent (the version without the
// profile picture): logo; name in bold; job title; WhoFoundWho in bold;
// "T: <mobile> | W: whofoundwho.co.uk"; the APSCo Compliance+ and
// Government Commercial Agency Supplier badges; the values line; the
// working-hours note. The per-person details (full name, job title,
// mobile) come from email_signatures, keyed by the sending address; the
// rest is the same for everyone. When the address has no row, the block is
// the name the caller had and the phone typed on the page.

export interface SignatureData {
  name: string;
  title?: string;
  company: string;
  phone?: string;
  /** The office number, shown after the mobile as "T: <mobile> / <office>". */
  officePhone?: string;
  linkedinUrl?: string;
  website?: string;
  websiteUrl?: string;
  logoUrl?: string;
  badges?: Array<{ src: string; alt: string; width: number; height: number }>;
  values?: string;
  valuesNote?: string;
  hoursNote?: string;
}

/** Where the signature's images are served from (the app's own site; the files are in public/email). */
export const SIGNATURE_ASSET_BASE = 'https://he-giveth.whofoundwho.co.uk/email';

export const HOUSE_SIGNATURE = {
  company: 'WhoFoundWho',
  website: 'whofoundwho.co.uk',
  websiteUrl: 'https://whofoundwho.co.uk',
  logoUrl: `${SIGNATURE_ASSET_BASE}/whofoundwho-logo.png`,
  badges: [
    { src: `${SIGNATURE_ASSET_BASE}/apsco-compliance-plus.png`, alt: 'APSCo Compliance+ Accredited', width: 104, height: 47 },
    { src: `${SIGNATURE_ASSET_BASE}/gca-supplier.jpg`, alt: 'Government Commercial Agency Supplier', width: 67, height: 60 },
  ],
  values: '‘Collaboration. Own It. Be Human. Be Excellent.’',
  valuesNote: 'Guided by these values, we strive for positive impact and meaningful connections.',
  hoursNote: '*At WhoFoundWho, we respect standard working hours and may not reply outside of this time. As we offer flexible working arrangements, if you do receive a message outside of these hours, please feel free to reply at your convenience during your next available opportunity.',
} as const;

export interface SignatureRow {
  email: string;
  full_name: string;
  job_title: string | null;
  mobile: string | null;
  office_phone?: string | null;
  linkedin_url?: string | null;
}

/** The block for a sending address: the row's details over the house layout; the caller's name and phone when there is no row. */
export function signatureFrom(row: SignatureRow | null | undefined, fallback: { name: string; phone?: string }): SignatureData {
  const name = (row?.full_name || '').trim() || fallback.name;
  const title = (row?.job_title || '').trim();
  const phone = (row?.mobile || '').trim() || (fallback.phone || '').trim();
  const officePhone = (row?.office_phone || '').trim();
  const linkedinUrl = (row?.linkedin_url || '').trim();
  return {
    name,
    title: title || undefined,
    phone: phone || undefined,
    officePhone: officePhone || undefined,
    linkedinUrl: linkedinUrl || undefined,
    ...HOUSE_SIGNATURE,
    badges: [...HOUSE_SIGNATURE.badges],
  };
}

// deno-lint-ignore no-explicit-any
export async function signatureFor(supabase: any, email: string, fallback: { name: string; phone?: string }): Promise<SignatureData> {
  const key = (email || '').trim().toLowerCase();
  if (!key) return signatureFrom(null, fallback);
  const { data, error } = await supabase.from('email_signatures').select('email, full_name, job_title, mobile, office_phone, linkedin_url').eq('email', key).maybeSingle();
  if (error) console.warn(`email_signatures could not be read for ${key} (${error.message}); signing with the name and phone given`);
  return signatureFrom(error ? null : (data as SignatureRow | null), fallback);
}

/** The signature as plain text, for the text part of the email and for tests. */
export function signatureText(s: SignatureData): string {
  const contact = [s.phone ? `T: ${[s.phone, s.officePhone].filter(Boolean).join(' / ')}` : '', s.website ? `W: ${s.website}` : ''].filter(Boolean).join('  |  ');
  const li = s.linkedinUrl ? `LI: ${s.linkedinUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}` : undefined;
  return [s.name, s.title, s.company, contact, li, '', s.values, s.valuesNote, '', s.hoursNote].filter((l) => l !== undefined && l !== null).map((l) => String(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
