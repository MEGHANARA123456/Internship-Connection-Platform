const CHART_PALETTE = [
  '#4f46e5',
  '#0891b2',
  '#7c3aed',
  '#db2777',
  '#059669',
  '#d97706',
  '#2563eb',
  '#c2410c',
  '#4d7c0f',
  '#9333ea',
  '#0f766e',
  '#be123c',
] as const

const SEMANTIC_STATUS_COLORS: Record<string, string> = {
  PUBLISHED: '#16a34a',
  DRAFT: '#64748b',
  PENDING_APPROVAL: '#d97706',
  PENDING: '#d97706',
  REJECTED: '#dc2626',
  CLOSED: '#6366f1',
  VERIFIED: '#16a34a',
  APPLIED: '#2563eb',
  UNDER_REVIEW: '#d97706',
  SHORTLISTED: '#7c3aed',
  INTERVIEW: '#0891b2',
  INTERVIEW_SCHEDULED: '#0891b2',
  SELECTED: '#059669',
  ACCEPTED: '#047857',
  WITHDRAWN: '#64748b',
  CANCELLED: '#64748b',
  COMPLETED: '#059669',
  SCHEDULED: '#0891b2',
}
const STATUS_COLORS = SEMANTIC_STATUS_COLORS
const SERIES_COLORS: Record<string, string> = {
  APPLICATION: '#4f46e5',
  APPLICATIONS: '#4f46e5',
  APPLICATIONS_FILED: '#4f46e5',
  APPLICATIONS_SUBMITTED: '#4f46e5',
  APPLICATIONS_RECEIVED: '#4f46e5',
  STUDENTS: '#4f46e5',
  INTERVIEWS: '#0891b2',
  INTERVIEW_STAGE_APPLICATIONS: '#0891b2',
  COMPANIES: '#059669',
  OFFERS: '#7c3aed',
  FINAL_OFFERS_ACCEPTED: '#7c3aed',
  MISSING: '#db2777',
  MEDIAN: '#d97706',
}

export function chartColorFor(key: string): string {
  const normalized = key.trim().replace(/\s+/g, '_').toUpperCase()
  const statusColor = STATUS_COLORS[normalized]
  if (statusColor) return statusColor
  const seriesColor = SERIES_COLORS[normalized]
  if (seriesColor) return seriesColor

  let hash = 0
  for (const character of key.trim().toLocaleLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return CHART_PALETTE[hash % CHART_PALETTE.length]
}
