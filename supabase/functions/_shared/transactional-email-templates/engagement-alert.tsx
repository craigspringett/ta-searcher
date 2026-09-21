import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Html, Link, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

// "Mrs Patel at Hatch End opened your email": the one-line alert a
// consultant gets the first time a contact opens, and the first time they
// click, an email they sent from TA Searcher (Craig, 18 September 2026).
// Short on purpose: who, which email, when, and the company page link.

interface Props {
  action?: 'opened' | 'clicked'
  contactName?: string
  contactEmail?: string
  companyName?: string
  companyUrl?: string | null
  subject?: string | null
  url?: string | null
  when?: string
  kind?: string
}

function whenWords(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
}

function EngagementAlert({ action = 'opened', contactName = 'The contact', contactEmail = '', companyName = 'the company', companyUrl, subject, url, when, kind }: Props) {
  const verb = action === 'clicked' ? 'clicked a link in' : 'opened'
  const what = kind === 'shortlist' ? 'the shortlist email' : 'your email'
  const at = whenWords(when)
  return (
    <Html lang="en-GB">
      <Head />
      <Preview>{`${contactName} at ${companyName} ${verb} ${what}`}</Preview>
      <Body style={{ backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif', color: '#1f2933', margin: 0 }}>
        <Container style={{ padding: '16px 0', maxWidth: '620px', margin: 0 }}>
          <Text style={{ fontSize: '16px', lineHeight: '1.5', margin: '0 0 12px 0', fontWeight: 'bold' }}>
            {contactName} at {companyName} {verb} {what}{at ? `, ${at}` : ''}.
          </Text>
          {subject && <Text style={{ fontSize: '14px', lineHeight: '1.5', margin: '0 0 8px 0', color: '#52606d' }}>Subject: {subject}</Text>}
          {url && <Text style={{ fontSize: '14px', lineHeight: '1.5', margin: '0 0 8px 0', color: '#52606d' }}>The link: {url}</Text>}
          {contactEmail && <Text style={{ fontSize: '14px', lineHeight: '1.5', margin: '0 0 8px 0', color: '#52606d' }}>{contactEmail}</Text>}
          <Text style={{ fontSize: '14px', lineHeight: '1.5', margin: '12px 0 0 0' }}>
            {action === 'clicked' ? 'A click is a good moment to ring. ' : 'Opens are a hint, not proof: some mail apps fetch the image on their own. '}
            {companyUrl ? <Link href={companyUrl} style={{ color: '#2a8a86' }}>Open the company page</Link> : null}
          </Text>
          <Text style={{ fontSize: '11px', lineHeight: '1.45', margin: '20px 0 0 0', color: '#7b8794' }}>Sent by TA Searcher once for the first open and once for the first click of each email. Ask Craig to switch these off for you if they are not useful.</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: EngagementAlert,
  subject: (d) => `${d.contactName || 'A contact'} at ${d.companyName || 'a company'} ${d.action === 'clicked' ? 'clicked a link in your email' : 'opened your email'}`,
  displayName: 'Engagement alert (open or click)',
  previewData: { action: 'clicked', contactName: 'Mrs Patel', contactEmail: 'head@example.sch.uk', companyName: 'Hatch End High Company', companyUrl: 'https://ta-searcher.netlify.app/companies/5b520572-812c-4831-9852-867489d813bb#contacts', subject: 'Your Year 4 post that closes on Friday', url: 'https://bigfishrecruitment.co.uk', when: '2026-09-21T12:05:00Z', kind: 'outreach' },
}
