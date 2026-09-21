import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Section, Hr, Link,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { VacancyCard, type VacancyCardItem } from './vacancy-card.tsx'

const SITE_NAME = "Big Fish Recruitment"

interface NewVacanciesAlertProps {
  consultant?: string
  date?: string
  newVacancies?: VacancyCardItem[]
  totalCount?: number
  /** Overrides the default "since the last refresh" line (used by the catch-up alert). */
  summaryLine?: string
  heading?: string
  unsubscribeUrl?: string
}

const NewVacanciesAlertEmail = ({
  consultant = '',
  date = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
  newVacancies = [],
  totalCount = 0,
  summaryLine,
  heading = 'New roles at your companies',
  unsubscribeUrl,
}: NewVacanciesAlertProps) => {
  const preview = `${totalCount} new ${totalCount === 1 ? 'role' : 'roles'} at your companies`
  return (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{preview}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={headerTitle}>{heading}</Heading>
          <Text style={headerDate}>{date}</Text>
          {consultant && <Text style={headerConsultant}>For {consultant}</Text>}
        </Section>

        <Section style={summarySection}>
          <Text style={summaryText}>
            {summaryLine ?? (
              <>
                <strong>{totalCount}</strong> new {totalCount === 1 ? 'role has' : 'roles have'} appeared at your companies since the last check.
              </>
            )}
          </Text>
        </Section>

        {newVacancies.length > 0 ? (
          <Section style={section}>
            {newVacancies.map((v, i) => (
              <VacancyCard key={i} v={v} accent="#17696e" />
            ))}
          </Section>
        ) : null}


        <Hr style={divider} />
        <Text style={footer}>
          Sent by {SITE_NAME} TA Searcher. Each line links to the advert; use "Wrong company" or "Closed" to correct a line.
          {unsubscribeUrl ? (
            <>
              {' '}<Link href={unsubscribeUrl} style={footerLink}>Unsubscribe from these alerts</Link>.
            </>
          ) : null}
        </Text>
      </Container>
    </Body>
  </Html>
  )
}

function subjectFor(data: Record<string, any>): string {
  const count = data.totalCount || 0
  const who = data.consultant || 'TA Searcher'
  return `${count} new ${count === 1 ? 'role' : 'roles'} at your companies, for ${who}`
}

export const template = {
  component: NewVacanciesAlertEmail,
  subject: (data: Record<string, any>) => data.subjectOverride || subjectFor(data),
  displayName: 'New roles alert',
  previewData: {
    consultant: 'Craig Springett',
    date: 'Friday, 25 September 2026',
    totalCount: 3,
    unsubscribeUrl: 'https://ta-searcher.netlify.app/unsubscribe?token=preview',
    newVacancies: [
      { title: 'Head of Talent', url: 'https://jobs.ashbyhq.com/example/1', sourceLabel: 'Ashby', companyName: 'Searchable', companyWebsite: 'https://www.searchable.com', location: 'London', department: 'People', jobLocation: 'London', workplaceType: 'hybrid', postedDate: 'Tue 22 Sep 2026', feedbackWrongCompanyUrl: 'https://example.com/feedback?k=wrong_company', feedbackClosedUrl: 'https://example.com/feedback?k=closed' },
      { title: 'Senior Engineer', url: 'https://jobs.ashbyhq.com/example/2', sourceLabel: 'Ashby', companyName: 'Searchable', companyWebsite: 'https://www.searchable.com', location: 'London', department: 'Engineering', jobLocation: 'London', workplaceType: 'onsite', postedDate: 'Mon 21 Sep 2026', feedbackWrongCompanyUrl: 'https://example.com/feedback?k=wrong_company', feedbackClosedUrl: 'https://example.com/feedback?k=closed' },
      { title: 'Account Executive', url: 'https://boards.greenhouse.io/example/jobs/3', sourceLabel: 'Greenhouse', companyName: 'Example Labs', companyWebsite: 'https://example.com', location: 'Manchester', department: 'Sales', jobLocation: 'Remote - UK', workplaceType: 'remote', feedbackWrongCompanyUrl: 'https://example.com/feedback?k=wrong_company', feedbackClosedUrl: 'https://example.com/feedback?k=closed' },
    ],
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { maxWidth: '600px', margin: '0 auto' }
const header = { backgroundColor: '#17696e', padding: '24px', borderRadius: '8px 8px 0 0' }
const headerTitle = { margin: '0', fontSize: '20px', fontWeight: 'bold' as const, color: '#ffffff' }
const headerDate = { margin: '8px 0 0', fontSize: '14px', color: 'rgba(255,255,255,0.9)' }
const headerConsultant = { margin: '4px 0 0', fontSize: '13px', color: 'rgba(255,255,255,0.8)' }
const summarySection = { padding: '20px 24px', backgroundColor: '#eff6ff', borderBottom: '1px solid #dbeafe' }
const summaryText = { fontSize: '15px', color: '#1e40af', margin: '0', lineHeight: '1.5' }
const section = { padding: '16px 24px' }
const divider = { borderColor: '#e5e7eb', margin: '16px 24px' }
const footer = { padding: '0 24px 16px', textAlign: 'center' as const, fontSize: '12px', color: '#999999' }
const footerLink = { color: '#999999', textDecoration: 'underline' }
