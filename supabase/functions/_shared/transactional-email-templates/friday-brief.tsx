import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Section, Hr, Link,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Big Fish Recruitment'

export interface BriefContact {
  name: string
  role: string
  email?: string
  /** "found" (on the company's site), "pattern_guess", or "role_only" (name and role, no address). */
  confidence?: string
}

export interface BriefCompany {
  rank: number
  name: string
  /** The stage guess in words: "Series A", "Seed". */
  stage?: string
  sector?: string
  /** Link to the company page in the app. */
  appUrl: string
  website?: string
  score: number
  band: 'hot' | 'warm' | 'cool'
  /** The one-line reason: the strongest signal's explanation. */
  reason: string
  /** Further signal labels, strongest first, without the one in `reason`. */
  alsoSignals?: string[]
  contact?: BriefContact | null
  phone?: string
  openVacancies?: number
  /** "Call back due Tue 15 Sep" or "Spoke to on 8 Sep", when there is one. */
  outcomeLine?: string
  consultant?: string
}

export interface BriefSection {
  title: string
  subtitle?: string
  companies: BriefCompany[]
}

interface FridayBriefProps {
  recipientName?: string
  weekOf?: string
  /** A one-line note for the week, or empty. */
  countdownLine?: string
  intro?: string
  /** Set on a director's copy: whose brief this is. */
  copyOf?: string
  sections?: BriefSection[]
  isManager?: boolean
  totals?: { hot: number; warm: number; cool: number; companies: number }
  unsubscribeUrl?: string
  appUrl?: string
}

const BAND_COLOURS: Record<string, { bg: string; fg: string; label: string }> = {
  hot: { bg: '#dcfce7', fg: '#166534', label: 'Call this week' },
  warm: { bg: '#fef3c7', fg: '#92400e', label: 'Worth a call' },
  cool: { bg: '#f3f4f6', fg: '#4b5563', label: 'Nothing pressing' },
}

const CompanyCard = ({ s }: { s: BriefCompany }) => {
  const band = BAND_COLOURS[s.band] || BAND_COLOURS.cool
  return (
    <Section style={card}>
      <Text style={titleLine}>
        <span style={rank}>{s.rank}.</span>{' '}
        <Link href={s.appUrl} style={{ color: '#122027', textDecoration: 'underline' }}>{s.name}</Link>
        {s.stage ? <span style={la}> · {s.stage}</span> : null}
        {s.sector ? <span style={la}> · {s.sector}</span> : null}
        {s.consultant ? <span style={la}> · {s.consultant}</span> : null}
        <span style={{ ...badge, backgroundColor: band.bg, color: band.fg }}>{s.score} · {band.label}</span>
      </Text>
      <Text style={reason}>{s.reason}</Text>
      {s.alsoSignals && s.alsoSignals.length ? <Text style={also}>Also: {s.alsoSignals.join(' · ')}</Text> : null}
      <Text style={contactLine}>
        {s.contact ? (
          <>
            <strong>{s.contact.name || s.contact.role}</strong>
            {s.contact.name && s.contact.role ? `, ${s.contact.role}` : ''}
            {s.contact.email ? <> · <Link href={`mailto:${s.contact.email}`} style={{ color: '#17696e' }}>{s.contact.email}</Link>{s.contact.confidence === 'pattern_guess' ? ' (pattern guess)' : ''}</> : ''}
          </>
        ) : 'No named contact yet'}
        {s.phone ? <> · {s.phone}</> : null}
        {typeof s.openVacancies === 'number' && s.openVacancies > 0 ? <> · {s.openVacancies} open {s.openVacancies === 1 ? 'vacancy' : 'vacancies'}</> : null}
      </Text>
      {s.outcomeLine ? <Text style={outcome}>{s.outcomeLine}</Text> : null}
    </Section>
  )
}

const FridayBriefEmail = ({
  recipientName = '',
  weekOf = '',
  countdownLine = '',
  intro,
  copyOf,
  sections = [],
  isManager = false,
  totals,
  unsubscribeUrl,
  appUrl = 'https://ta-searcher.netlify.app',
}: FridayBriefProps) => {
  const count = sections.reduce((n, s) => n + s.companies.length, 0)
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{isManager ? `The week's calls across the team: ${count} companies` : `Your ${count} companies to call in the week of ${weekOf}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Heading style={headerTitle}>{isManager ? 'The week ahead, across the team' : 'Your companies to call this week'}</Heading>
            <Text style={headerDate}>Week of {weekOf}{recipientName ? ` · for ${recipientName}` : ''}{copyOf ? ` · a copy of ${copyOf}'s brief` : ''}</Text>
          </Section>

          <Section style={summarySection}>
            <Text style={summaryText}>
              {intro ?? (isManager
                ? <>{totals ? <><strong>{totals.hot}</strong> companies to call this week, <strong>{totals.warm}</strong> worth a call, <strong>{totals.cool}</strong> quiet, of {totals.companies}. </> : null}Each consultant has had their own list.</>
                : <>Ranked by how likely each company is to buy now: the signals we can point to, adjusted for your call outcomes. Each line has the reason and the person to ask for. Open a company for every line behind its score.</>)}
            </Text>
            {countdownLine ? <Text style={countdown}>{countdownLine}</Text> : null}
          </Section>

          {sections.map((sec, i) => (
            <Section key={i} style={section}>
              <Heading as="h2" style={sectionTitle}>{sec.title}</Heading>
              {sec.subtitle ? <Text style={sectionSubtitle}>{sec.subtitle}</Text> : null}
              {sec.companies.length === 0 ? <Text style={empty}>No company has a score on today's signals.</Text> : sec.companies.map((s) => <CompanyCard key={s.rank + s.name} s={s} />)}
            </Section>
          ))}

          <Hr style={divider} />
          <Text style={footer}>
            Sent by {SITE_NAME} TA Searcher every Friday morning. <Link href={appUrl} style={footerLink}>Open My patch</Link> for the full list and to log calls.
            {unsubscribeUrl ? <> <Link href={unsubscribeUrl} style={footerLink}>Unsubscribe from the Friday brief</Link>.</> : null}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: FridayBriefEmail,
  subject: (data: Record<string, any>) => data.subjectOverride || (data.isManager ? `The week ahead across the team — ${data.weekOf || 'Friday brief'}` : `Your companies to call, week of ${data.weekOf || 'next week'}`),
  displayName: 'Friday brief',
  previewData: {
    recipientName: 'Luke Carnell',
    weekOf: '14 September 2026',
    countdownLine: '',
    sections: [{
      title: 'Your 5 companies to call', subtitle: 'The 5 of your 40 companies most likely to buy now (2 to call this week, 11 worth a call).',
      companies: [
        { rank: 1, name: 'Searchable', stage: 'Series A', sector: 'Software', appUrl: 'https://ta-searcher.netlify.app/companies/x', score: 78, band: 'hot', reason: 'Head of Talent is advertised on Ashby, posted 22 Sep; 13 other roles are open across sales, marketing, design and engineering.', alsoSignals: ['Raised recently', 'Many open roles'], contact: { name: 'Jane Founder', role: 'Founder / CEO', email: 'jane@searchable.example', confidence: 'found' }, phone: '020 8000 0000', openVacancies: 14 },
        { rank: 2, name: 'Example Labs', stage: 'Seed', sector: 'Data and platforms', appUrl: 'https://ta-searcher.netlify.app/companies/y', score: 62, band: 'hot', reason: 'Raised a £4m seed round led by Example Ventures in July 2026 and has 6 open roles with nobody in a people or talent role.', contact: { name: 'Sam Director', role: 'Director (Companies House)', confidence: 'role_only' }, outcomeLine: 'Call back due Tue 29 Sep' },
        { rank: 3, name: 'Third Startup', stage: 'Unknown', appUrl: 'https://ta-searcher.netlify.app/companies/z', score: 41, band: 'warm', reason: 'Senior Backend Engineer has been advertised for 52 days.', contact: null },
      ],
    }],
    unsubscribeUrl: 'https://ta-searcher.netlify.app/unsubscribe?token=preview',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { maxWidth: '640px', margin: '0 auto' }
const header = { backgroundColor: '#122027', padding: '24px', borderRadius: '8px 8px 0 0' }
const headerTitle = { margin: '0', fontSize: '20px', fontWeight: 'bold' as const, color: '#ffffff' }
const headerDate = { margin: '8px 0 0', fontSize: '14px', color: 'rgba(255,255,255,0.85)' }
const summarySection = { padding: '18px 24px', backgroundColor: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }
const summaryText = { fontSize: '14px', color: '#1f2937', margin: '0', lineHeight: '1.5' }
const countdown = { fontSize: '14px', color: '#92400e', margin: '10px 0 0', lineHeight: '1.5', fontWeight: 'bold' as const }
const section = { padding: '12px 24px 4px' }
const sectionTitle = { fontSize: '16px', margin: '8px 0 4px', color: '#122027' }
const sectionSubtitle = { fontSize: '12px', color: '#6b7280', margin: '0 0 10px' }
const empty = { fontSize: '13px', color: '#6b7280' }
const card = { backgroundColor: '#f9fafb', borderRadius: '6px', padding: '12px 14px', marginBottom: '10px', borderLeft: '4px solid #cbd5e1' }
const titleLine = { fontWeight: 'bold' as const, color: '#122027', margin: '0 0 6px', fontSize: '14px', lineHeight: '1.6' }
const rank = { color: '#6b7280', fontWeight: 'normal' as const }
const la = { color: '#6b7280', fontWeight: 'normal' as const, fontSize: '12px' }
const badge = { display: 'inline-block', marginLeft: '8px', padding: '1px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 'bold' as const, verticalAlign: 'middle' }
const reason = { color: '#1f2937', fontSize: '13px', margin: '0 0 4px', lineHeight: '1.5' }
const also = { color: '#6b7280', fontSize: '12px', margin: '0 0 4px' }
const contactLine = { color: '#374151', fontSize: '12px', margin: '0 0 2px', lineHeight: '1.5' }
const outcome = { color: '#17696e', fontSize: '12px', margin: '2px 0 0', fontWeight: 'bold' as const }
const divider = { borderColor: '#e5e7eb', margin: '16px 24px' }
const footer = { padding: '0 24px 16px', textAlign: 'center' as const, fontSize: '12px', color: '#999999' }
const footerLink = { color: '#999999', textDecoration: 'underline' }
