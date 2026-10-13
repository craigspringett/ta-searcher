// The signature block on emails sent in a consultant's name (company
// outreach and follow-ups through send-outreach-email).
//
// Craig, 13 October 2026: the block copies his Outlook signature. "Regards,"
// then the photo, the name and job title in teal, "E: <address>" and
// "M: <mobile>", the Big Fish logo on the right with the Sourcr reviews
// badge under it, and a grey band with "Big Fish Recruitment" and the
// office address. The per-person details (full name, job title, mobile,
// photo) come from email_signatures, keyed by the sending address; the rest
// is the same for everyone. When the address has no row, the block is the
// name the caller had and the phone typed on the page.

export interface SignatureData {
  name: string;
  title?: string;
  company: string;
  email?: string;
  phone?: string;
  /** The office number, shown after the mobile. */
  officePhone?: string;
  linkedinUrl?: string;
  website?: string;
  websiteUrl?: string;
  logoUrl?: string;
  photoUrl?: string;
  /** Extra images under the logo (the Sourcr reviews badge). */
  badges?: Array<{ src: string; alt: string; width: number; height: number; href?: string }>;
  address?: string;
  signOff?: string;
}

/** Where the signature's images are served from (the app's own site; the files are in public/email). */
export const SIGNATURE_ASSET_BASE = 'https://ta-searcher.netlify.app/email';

export const HOUSE_SIGNATURE = {
  company: 'Big Fish Recruitment',
  website: 'bigfishrecruitment.co.uk',
  websiteUrl: 'https://bigfishrecruitment.co.uk',
  logoUrl: `${SIGNATURE_ASSET_BASE}/bigfish-logo.png`,
  badges: [
    { src: `${SIGNATURE_ASSET_BASE}/sourcr-reviews.png`, alt: 'Check out my reviews on Sourcr', width: 160, height: 68 },
  ],
  address: 'Kemp House, 152-160 City Road, London, EC1V 2NX',
  signOff: 'Regards,',
} as const;

/** The photo for a sending address, when the site has one (public/email/<local part>.png). */
const PHOTOS: Record<string, string> = {
  'craig@bigfishrecruitment.co.uk': `${SIGNATURE_ASSET_BASE}/craig-springett.png`,
};

export interface SignatureRow {
  email: string;
  full_name: string;
  job_title: string | null;
  mobile: string | null;
  office_phone?: string | null;
  linkedin_url?: string | null;
}

/** The block for a sending address: the row's details over the house layout; the caller's name and phone when there is no row. */
export function signatureFrom(row: SignatureRow | null | undefined, fallback: { name: string; phone?: string; email?: string }): SignatureData {
  const name = (row?.full_name || '').trim() || fallback.name;
  const email = ((row?.email || fallback.email || '')).trim().toLowerCase();
  const title = (row?.job_title || '').trim();
  const phone = (row?.mobile || '').trim() || (fallback.phone || '').trim();
  const officePhone = (row?.office_phone || '').trim();
  const linkedinUrl = (row?.linkedin_url || '').trim();
  return {
    name,
    title: title || undefined,
    email: email || undefined,
    phone: phone || undefined,
    officePhone: officePhone || undefined,
    linkedinUrl: linkedinUrl || undefined,
    photoUrl: PHOTOS[email],
    ...HOUSE_SIGNATURE,
    badges: [...HOUSE_SIGNATURE.badges],
  };
}

// deno-lint-ignore no-explicit-any
export async function signatureFor(supabase: any, email: string, fallback: { name: string; phone?: string }): Promise<SignatureData> {
  const key = (email || '').trim().toLowerCase();
  if (!key) return signatureFrom(null, fallback);
  fallback = { ...fallback, email: key } as typeof fallback;
  const { data, error } = await supabase.from('email_signatures').select('email, full_name, job_title, mobile, office_phone, linkedin_url').eq('email', key).maybeSingle();
  if (error) console.warn(`email_signatures could not be read for ${key} (${error.message}); signing with the name and phone given`);
  return signatureFrom(error ? null : (data as SignatureRow | null), fallback);
}

/** The signature as plain text, for the text part of the email and for tests. */
export function signatureText(s: SignatureData): string {
  const email = s.email ? `E: ${s.email}` : undefined;
  const mobile = s.phone ? `M: ${[s.phone, s.officePhone].filter(Boolean).join(' / ')}` : undefined;
  const li = s.linkedinUrl ? `LI: ${s.linkedinUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}` : undefined;
  return [s.signOff, '', s.name, s.title, email, mobile, li, '', s.company, s.address, s.website].filter((l) => l !== undefined && l !== null).map((l) => String(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
