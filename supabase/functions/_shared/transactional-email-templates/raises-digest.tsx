import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

// The weekly raises digest (Monday 07:00 UTC): every raise the radar saw
// last week in the chosen sectors and stages, grouped by sector, each
// with the headline, the amount and round, and a link to the company on
// TA Searcher (or the Prospects page when it is not tracked yet).

interface DigestItem {
  name: string
  sector: string
  stage: string
  raiseLine: string
  date: string
  headline: string | null
  storyUrl: string | null
  website: string | null
  locality: string | null
  score: number | null
  appUrl: string
  tracked: boolean
}

interface DigestSection { sector: string; items: DigestItem[] }

interface Props {
  recipientName?: string
  weekEnding?: string
  sections?: DigestSection[]
  count?: number
  filteredOut?: number
  sectorsLine?: string
  appUrl?: string
}

function dateWords(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d)
}

const RaisesDigestEmail = ({ recipientName = '', weekEnding = '', sections = [], count = 0, filteredOut = 0, sectorsLine = 'every sector', appUrl = 'https://ta-searcher.netlify.app' }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{count === 0 ? 'No new raises in your sectors this week' : `${count} new ${count === 1 ? 'raise' : 'raises'} in your sectors this week`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={headerTitle}>New raises this week</Heading>
          <Text style={headerDate}>Week ending {weekEnding}{recipientName ? ` · for ${recipientName}` : ''} · {sectorsLine}</Text>
        </Section>
        <Section style={body}>
          {count === 0 ? (
            <Text style={para}>The radar saw no raise in your sectors and stages this week. Widen the sectors on the Alerts page if that looks too quiet.</Text>
          ) : (
            <Text style={para}>{count} {count === 1 ? 'company' : 'companies'} raised in your sectors this week. A raise is the moment a founder starts thinking about who will run hiring; the ones marked tracked are already on the patch with a script written.</Text>
          )}
          {sections.map((s) => (
            <Section key={s.sector} style={{ marginBottom: '14px' }}>
              <Text style={sectionTitle}>{s.sector} · {s.items.length}</Text>
              {s.items.map((it) => (
                <Section key={`${it.name}-${it.date}`} style={card}>
                  <Text style={titleLine}>
                    <Link href={it.appUrl} style={{ color: '#122027', textDecoration: 'underline' }}>{it.name}</Link>
                    <span style={la}> · {it.raiseLine}</span>
                    <span style={la}> · {it.stage}</span>
                    {it.locality ? <span style={la}> · {it.locality}</span> : null}
                    <span style={la}> · {dateWords(it.date)}</span>
                    {it.tracked ? <span style={badge}>tracked</span> : null}
                  </Text>
                  {it.headline ? <Text style={reason}>{it.storyUrl ? <Link href={it.storyUrl} style={{ color: '#17696e' }}>{it.headline}</Link> : it.headline}</Text> : null}
                  {it.website ? <Text style={reason}><Link href={it.website} style={{ color: '#17696e' }}>{it.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</Link></Text> : null}
                </Section>
              ))}
            </Section>
          ))}
          {filteredOut > 0 ? <Text style={small}>{filteredOut} other {filteredOut === 1 ? 'raise' : 'raises'} this week fell outside your sectors or stages. See them all on the <Link href={`${appUrl}/prospects`} style={{ color: '#17696e' }}>Prospects page</Link>.</Text> : null}
        </Section>
        <Section style={footer}>
          <Text style={{ margin: 0 }}>TA Searcher, Big Fish Recruitment. Change the sectors and stages on the <Link href={`${appUrl}/alerts`} style={{ color: '#999999' }}>Alerts page</Link>.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template: TemplateEntry = {
  component: RaisesDigestEmail,
  subject: (data: Record<string, any>) => data.subjectOverride || (data.count === 0 ? 'No new raises in your sectors this week' : `${data.count} new ${data.count === 1 ? 'raise' : 'raises'} in your sectors this week`),
  displayName: 'Weekly raises digest',
  previewData: {
    recipientName: 'Craig Springett',
    weekEnding: '2026-09-22',
    count: 2,
    filteredOut: 5,
    sectorsLine: 'Fintech, AI and Healthtech',
    sections: [
      { sector: 'Fintech', items: [{ name: 'Sprive', sector: 'Fintech', stage: 'Series A', raiseLine: '$10m Series A', date: '2026-09-21', headline: 'Sprive raises $10m in Series A funding round', storyUrl: 'https://example.com/sprive', website: 'https://sprive.com/', locality: 'London', score: 40, appUrl: 'https://ta-searcher.netlify.app/prospects', tracked: false }] },
      { sector: 'AI', items: [{ name: 'Magentic', sector: 'AI', stage: 'Seed', raiseLine: '$18M', date: '2026-09-17', headline: "London's Magentic raises $18M to build AI agents", storyUrl: 'https://example.com/magentic', website: 'https://magentic.ai/', locality: null, score: 55, appUrl: 'https://ta-searcher.netlify.app/companies/x', tracked: true }] },
    ],
  },
}

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { maxWidth: '640px', margin: '0 auto' }
const header = { backgroundColor: '#17696e', padding: '24px', borderRadius: '8px 8px 0 0' }
const headerTitle = { margin: '0', fontSize: '20px', fontWeight: 'bold' as const, color: '#ffffff' }
const headerDate = { margin: '8px 0 0', fontSize: '14px', color: 'rgba(255,255,255,0.85)' }
const body = { padding: '16px 24px' }
const para = { fontSize: '14px', color: '#1f2937', lineHeight: '1.5', margin: '0 0 14px' }
const sectionTitle = { fontSize: '13px', fontWeight: 'bold' as const, color: '#17696e', margin: '0 0 6px', textTransform: 'uppercase' as const, letterSpacing: '0.04em' }
const card = { backgroundColor: '#f9fafb', borderRadius: '6px', padding: '10px 12px', marginBottom: '8px', borderLeft: '4px solid #a6dcdb' }
const titleLine = { fontWeight: 'bold' as const, color: '#122027', margin: '0 0 4px', fontSize: '14px', lineHeight: '1.6' }
const la = { color: '#6b7280', fontWeight: 'normal' as const, fontSize: '12px' }
const badge = { display: 'inline-block', marginLeft: '6px', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#dcfce7', color: '#166534', fontSize: '11px', fontWeight: 'bold' as const }
const reason = { color: '#1f2937', fontSize: '13px', margin: '0 0 2px', lineHeight: '1.5' }
const small = { fontSize: '12px', color: '#6b7280', margin: '8px 0 0' }
const footer = { padding: '0 24px 16px', textAlign: 'center' as const, fontSize: '12px', color: '#999999' }
