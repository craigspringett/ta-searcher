import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Html, Img, Link, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import type { SignatureData } from '../signature.ts'

// An outreach email to a company (Follow-ups slice 1): the consultant's own
// words, typed or pasted in the app or drafted for them, rendered as plain
// paragraphs so it reads as one person writing to another. No header, no
// branding block, no unsubscribe line (it is a one-to-one business email; a
// "stop" reply is honoured by the consultant logging "not interested", and a
// complaint suppresses the address). The signature copies Craig's Outlook
// signature (13 October 2026): "Regards," then the photo, the name and job
// title in teal, E: and M: lines, the logo and the Sourcr badge on the
// right, and a grey band with the firm and the office address. A body that
// ends with its own sign-off line ("Best wishes,") loses it, so the block's
// "Regards," is the only sign-off. A caller that passes only a name and
// phone gets those two lines and the company, as before.

interface OutreachEmailProps {
  subject?: string
  body?: string
  signature?: Partial<SignatureData>
  unsubscribeUrl?: string
}

const text = { fontSize: '15px', lineHeight: '1.5', margin: '0 0 14px 0', whiteSpace: 'pre-line' as const }
const sigText = { fontSize: '14px', lineHeight: '1.5', margin: 0, color: '#1f2933' }
const TEAL = '#1f8a8a'
const SIGN_OFFS = /^(best wishes|kind regards|warm regards|regards|best|thanks|many thanks|thank you|cheers|all the best|yours sincerely|yours faithfully|best regards)[,.!]?$/i

/** The body without a trailing sign-off line of its own, so the signature's sign-off is the only one. */
export function stripSignOff(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').trimEnd().split('\n')
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (lines.length && SIGN_OFFS.test(lines[lines.length - 1].trim())) lines.pop()
  return lines.join('\n').trimEnd()
}

function Signature({ s }: { s: Partial<SignatureData> }) {
  const name = (s.name || '').trim()
  const company = (s.company || '').trim()
  const rich = Boolean(s.logoUrl || s.title || s.address)
  if (!rich) {
    const lines = [name, company, s.phone].filter((x) => x && String(x).trim())
    if (!lines.length) return null
    return (
      <Text style={{ fontSize: '15px', lineHeight: '1.5', margin: '20px 0 0 0' }}>
        {lines.map((line, i) => <React.Fragment key={`s${i}`}>{i > 0 && <br />}{line}</React.Fragment>)}
      </Text>
    )
  }
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ marginTop: '8px', borderCollapse: 'collapse', width: '100%', maxWidth: '620px' }}>
      <tbody>
        <tr><td colSpan={3}><Text style={{ ...text, margin: '0 0 14px 0' }}>{s.signOff || 'Regards,'}</Text></td></tr>
        <tr>
          {s.photoUrl && (
            <td style={{ verticalAlign: 'top', padding: '0 18px 0 0', width: '110px' }}>
              <Img src={s.photoUrl} alt={name} width={110} height={114} style={{ display: 'block', border: 0, borderRadius: '55px' }} />
            </td>
          )}
          <td style={{ verticalAlign: 'top', padding: '4px 12px 0 0' }}>
            <Text style={{ ...sigText, fontSize: '18px', color: TEAL, lineHeight: '1.3' }}>{name}</Text>
            {s.title && <Text style={{ ...sigText, fontSize: '16px', color: TEAL, fontWeight: 'bold', lineHeight: '1.4' }}>{s.title}</Text>}
            <Text style={{ ...sigText, margin: '14px 0 0 0' }}>
              {s.email && <><b>E:</b>&nbsp;&nbsp;<Link href={`mailto:${s.email}`} style={{ color: '#1f2933', textDecoration: 'underline' }}>{s.email}</Link></>}
              {s.email && s.phone && <br />}
              {s.phone && <><b>M:</b> <b style={{ color: TEAL }}>{[s.phone, s.officePhone].filter(Boolean).join(' / ')}</b></>}
            </Text>
          </td>
          {(s.logoUrl || (s.badges && s.badges.length > 0)) && (
            <td style={{ verticalAlign: 'top', textAlign: 'right', width: '170px' }}>
              {s.logoUrl && <Img src={s.logoUrl} alt={company || 'Big Fish Recruitment'} width={160} height={120} style={{ display: 'inline-block', border: 0 }} />}
              {s.badges && s.badges.map((b, i) => (
                b.href
                  ? <Link key={`b${i}`} href={b.href}><Img src={b.src} alt={b.alt} width={b.width} height={b.height} style={{ display: 'inline-block', border: 0, marginTop: '6px' }} /></Link>
                  : <Img key={`b${i}`} src={b.src} alt={b.alt} width={b.width} height={b.height} style={{ display: 'inline-block', border: 0, marginTop: '6px' }} />
              ))}
            </td>
          )}
        </tr>
        {(company || s.address) && (
          <tr><td colSpan={3} style={{ padding: '14px 0 0 0' }}>
            <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ width: '100%', backgroundColor: '#f2f2f2', borderCollapse: 'collapse' }}>
              <tbody><tr><td style={{ padding: '10px 12px', textAlign: 'center' }}>
                {company && <Text style={{ ...sigText, fontSize: '16px', fontWeight: 'bold', color: '#111111' }}>{company}</Text>}
                {s.address && <Text style={{ ...sigText, color: '#111111' }}>{s.address}</Text>}
                {s.website && <Text style={{ ...sigText, fontSize: '12px' }}><Link href={s.websiteUrl || `https://${s.website}`} style={{ color: TEAL, textDecoration: 'none' }}>{s.website}</Link></Text>}
              </td></tr></tbody>
            </table>
          </td></tr>
        )}
      </tbody>
    </table>
  )
}

function OutreachEmail({ body = '', signature }: OutreachEmailProps) {
  const rich = Boolean(signature && (signature.logoUrl || signature.title || signature.address))
  const paragraphs = (rich ? stripSignOff(body) : body).replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  // No preheader: a mail client then shows the first line of the body as
  // its snippet, as it does for any personal email.
  return (
    <Html lang="en-GB">
      <Head />
      <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif', color: '#1f2933', margin: 0 }}>
        <Container style={{ padding: '16px 0', maxWidth: '620px', margin: 0 }}>
          {paragraphs.map((p, i) => (
            <Text key={i} style={text}>{p}</Text>
          ))}
          {signature && <Signature s={signature} />}
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: OutreachEmail,
  subject: (data) => String(data.subject || 'From Big Fish Recruitment'),
  displayName: 'Outreach email (Follow-ups and Shortlister)',
  previewData: {
    subject: 'Fifteen minutes on your hiring plan',
    body: "Hey Jane,\n\nI saw the Head of Talent post on your Ashby board this week, alongside twelve other open roles. I placed the Head of Recruitment at Searchable, a Series A team at the same stage, and it may be worth fifteen minutes on what that build-out looked like.\n\nWould Tuesday or Wednesday afternoon suit?\n\nBest wishes,",
    signature: {
      name: 'Craig Springett',
      title: 'Director',
      company: 'Big Fish Recruitment',
      email: 'craig@bigfishrecruitment.co.uk',
      phone: '07902 371 136',
      website: 'bigfishrecruitment.co.uk',
      websiteUrl: 'https://bigfishrecruitment.co.uk',
      logoUrl: 'https://ta-searcher.netlify.app/email/bigfish-logo.png',
      photoUrl: 'https://ta-searcher.netlify.app/email/craig-springett.png',
      badges: [{ src: 'https://ta-searcher.netlify.app/email/sourcr-reviews.png', alt: 'Check out my reviews on Sourcr', width: 160, height: 68 }],
      address: 'Kemp House, 152-160 City Road, London, EC1V 2NX',
      signOff: 'Regards,',
    },
  },
}
