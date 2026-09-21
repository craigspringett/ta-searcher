import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Html, Img, Link, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import type { SignatureData } from '../signature.ts'

// An outreach email to a company (Follow-ups slice 1) or to a candidate (CRM
// Shortlister): the consultant's own words, typed or pasted in the app or
// drafted for them, rendered as plain paragraphs so it reads as one person
// writing to another. No header, no branding block, no unsubscribe line (it
// is a one-to-one business email; a "stop" reply is honoured by the
// consultant logging "not interested", and a complaint suppresses the
// address). The signature is the team's house block (Craig, 18 September
// 2026, the house block): logo, name, job title,
// the firm, mobile and website, optional badges, the values
// line and the working-hours note. A caller that passes only a name and
// phone gets those two lines and the company, as before.

interface OutreachEmailProps {
  subject?: string
  body?: string
  signature?: Partial<SignatureData>
  unsubscribeUrl?: string
}

const text = { fontSize: '15px', lineHeight: '1.5', margin: '0 0 14px 0', whiteSpace: 'pre-line' as const }
const sigText = { fontSize: '13px', lineHeight: '1.45', margin: 0, color: '#1f2933' }
const small = { fontSize: '11px', lineHeight: '1.45', margin: '10px 0 0 0', color: '#52606d' }
const TEAL = '#2a8a86'

function Signature({ s }: { s: Partial<SignatureData> }) {
  const name = (s.name || '').trim()
  const company = (s.company || '').trim()
  const contact = [s.phone ? `T: ${s.phone}` : '', s.website ? 'W: ' : ''].filter(Boolean)
  const rich = Boolean(s.logoUrl || s.title || s.badges?.length || s.values)
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
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={{ marginTop: '24px', borderCollapse: 'collapse' }}>
      <tbody>
        {s.logoUrl && (
          <tr><td style={{ padding: '0 0 8px 0' }}><Img src={s.logoUrl} alt={company || 'Big Fish Recruitment'} width={94} height={92} style={{ display: 'block', border: 0 }} /></td></tr>
        )}
        <tr><td>
          <Text style={{ ...sigText, fontWeight: 'bold' }}>{name}</Text>
          {s.title && <Text style={sigText}>{s.title}</Text>}
          {company && <Text style={{ ...sigText, fontWeight: 'bold' }}>{company}</Text>}
          {(s.phone || s.website) && (
            <Text style={sigText}>
              {s.phone && <>T: {[s.phone, s.officePhone].filter(Boolean).join(' / ')}</>}
              {s.phone && s.website && <>&nbsp;&nbsp;|&nbsp;&nbsp;</>}
              {s.website && <>W: <Link href={s.websiteUrl || `https://${s.website}`} style={{ color: TEAL, textDecoration: 'none' }}>{s.website}</Link></>}
            </Text>
          )}
          {s.linkedinUrl && (
            <Text style={sigText}>LI: <Link href={s.linkedinUrl} style={{ color: TEAL, textDecoration: 'none' }}>{s.linkedinUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</Link></Text>
          )}
        </td></tr>
        {s.badges && s.badges.length > 0 && (
          <tr><td style={{ padding: '10px 0 0 0' }}>
            {s.badges.map((b, i) => (
              <Img key={`b${i}`} src={b.src} alt={b.alt} width={b.width} height={b.height} style={{ display: 'inline-block', verticalAlign: 'middle', border: 0, marginRight: i < (s.badges?.length || 0) - 1 ? '12px' : 0 }} />
            ))}
          </td></tr>
        )}
        {(s.values || s.valuesNote) && (
          <tr><td style={{ padding: '10px 0 0 0' }}>
            {s.values && <Text style={{ ...sigText, fontWeight: 'bold', fontStyle: 'italic' }}>{s.values}</Text>}
            {s.valuesNote && <Text style={sigText}>{s.valuesNote}</Text>}
          </td></tr>
        )}
        {s.hoursNote && <tr><td><Text style={{ ...small, fontStyle: 'italic' }}>{s.hoursNote}</Text></td></tr>}
      </tbody>
    </table>
  )
}

function OutreachEmail({ body = '', signature }: OutreachEmailProps) {
  const paragraphs = body.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
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
    body: "Dear Jane,\n\nI saw the Head of Talent post on your Ashby board this week, alongside twelve other open roles. I placed the Head of Recruitment at Searchable, a Series A team at the same stage, and it may be worth fifteen minutes on what that build-out looked like.\n\nWould Tuesday or Wednesday afternoon suit?\n\nBest wishes,",
    signature: {
      name: 'Craig Springett',
      title: 'Founder',
      company: 'Big Fish Recruitment',
      phone: '07742 023944',
      website: 'bigfishrecruitment.co.uk',
      websiteUrl: 'https://bigfishrecruitment.co.uk',
      values: '‘Collaboration. Own It. Be Human. Be Excellent.’',
      valuesNote: 'Guided by these values, we strive for positive impact and meaningful connections.',
      hoursNote: '*At Big Fish Recruitment, we respect standard working hours and may not reply outside of this time. As we offer flexible working arrangements, if you do receive a message outside of these hours, please feel free to reply at your convenience during your next available opportunity.',
    },
  },
}
