/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Link, Section, Text } from 'npm:@react-email/components@0.0.22'

export interface VacancyCardItem {
  title: string
  url?: string
  sourceLabel?: string
  companyName: string
  companyWebsite?: string
  /** Where the company is registered, e.g. "London". */
  location?: string
  department?: string
  /** The role's own location from the feed, e.g. "London" or "Remote - UK". */
  jobLocation?: string
  workplaceType?: string
  /** Formatted, e.g. "Fri 4 Jul 2026" */
  postedDate?: string
  closingDate?: string
  feedbackWrongCompanyUrl?: string
  feedbackClosedUrl?: string
}

export const VacancyCard = ({ v, accent = '#2563eb', urgent = false }: { v: VacancyCardItem; accent?: string; urgent?: boolean }) => (
  <Section style={{ ...card, borderLeft: `4px solid ${urgent ? '#dc2626' : accent}` }}>
    <Text style={title}>
      {v.url ? <Link href={v.url} style={{ color: accent, textDecoration: 'underline' }}>{v.title}</Link> : v.title}
      {v.sourceLabel ? <span style={source}> · {v.sourceLabel}</span> : null}
    </Text>
    <Text style={company}>
      {v.companyWebsite ? <Link href={v.companyWebsite} style={{ color: '#444444' }}>{v.companyName}</Link> : v.companyName}
      {v.location ? <span style={la}> · {v.location}</span> : null}
    </Text>
    {(v.department || v.jobLocation || v.workplaceType) ? <Text style={start}>{[v.department, v.jobLocation, v.workplaceType].filter(Boolean).join(' · ')}</Text> : null}
    {v.postedDate ? <Text style={start}>Posted: {v.postedDate}</Text> : null}
    {v.closingDate ? <Text style={{ ...closing, color: urgent ? '#dc2626' : '#374151' }}>Closing date: {v.closingDate}</Text> : null}
    {(v.feedbackWrongCompanyUrl || v.feedbackClosedUrl) ? (
      <Text style={feedback}>
        Not right?{' '}
        {v.feedbackWrongCompanyUrl ? <Link href={v.feedbackWrongCompanyUrl} style={feedbackLink}>Wrong company</Link> : null}
        {v.feedbackWrongCompanyUrl && v.feedbackClosedUrl ? ' · ' : null}
        {v.feedbackClosedUrl ? <Link href={v.feedbackClosedUrl} style={feedbackLink}>Closed</Link> : null}
      </Text>
    ) : null}
  </Section>
)

const card = { backgroundColor: '#f9fafb', borderRadius: '6px', padding: '12px 14px', marginBottom: '10px' }
const title = { fontWeight: 'bold' as const, color: '#122027', margin: '0 0 4px', fontSize: '14px' }
const source = { fontWeight: 'normal' as const, color: '#6b7280', fontSize: '12px' }
const company = { color: '#444444', fontSize: '13px', margin: '0 0 4px' }
const la = { color: '#888888', fontSize: '12px' }
const closing = { fontSize: '12px', fontWeight: 'bold' as const, margin: '0 0 2px' }
const start = { color: '#6b7280', fontSize: '12px', margin: '0 0 2px' }
const feedback = { color: '#9ca3af', fontSize: '11px', margin: '6px 0 0' }
const feedbackLink = { color: '#9ca3af', textDecoration: 'underline' }
