/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as newVacanciesAlert } from './new-vacancies-alert.tsx'
import { template as fridayBrief } from './friday-brief.tsx'
import { template as outreachEmail } from './outreach-email.tsx'
import { template as engagementAlert } from './engagement-alert.tsx'
import { template as raisesDigest } from './raises-digest.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'new-vacancies-alert': newVacanciesAlert,
  'friday-brief': fridayBrief,
  'outreach-email': outreachEmail,
  'engagement-alert': engagementAlert,
  'raises-digest': raisesDigest,
}
