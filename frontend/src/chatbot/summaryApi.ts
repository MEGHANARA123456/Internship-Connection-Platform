import { api } from '../api/client'
import type { PersonalSummary } from './types'

type Metric = { value?: unknown }
type Insights = { kpis?: Record<string, Metric> }

function metricValue(data: Insights, key: string): number {
  const value = data.kpis?.[key]?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export async function fetchPersonalSummary(
  role: 'STUDENT' | 'COMPANY' | 'ADMIN',
): Promise<PersonalSummary> {
  if (role === 'STUDENT') {
    const { data } = await api.get<Insights>('/students/me/insights?range=30')
    return {
      title: 'Your application summary',
      items: [
        { label: 'Applications', value: metricValue(data, 'applications_submitted') },
        { label: 'Under review', value: metricValue(data, 'under_review') },
        { label: 'Shortlisted', value: metricValue(data, 'shortlisted') },
        { label: 'Offers', value: metricValue(data, 'offers') },
      ],
      link: { label: 'Open applications', route: '/applications' },
    }
  }
  if (role === 'COMPANY') {
    const { data } = await api.get<Insights>('/companies/me/insights?range=30')
    return {
      title: 'Your roles and applicants (last 30 days)',
      items: [
        { label: 'Open roles', value: metricValue(data, 'active_roles') },
        { label: 'New applicants', value: metricValue(data, 'total_applicants') },
        { label: 'Shortlisted', value: metricValue(data, 'shortlisted') },
      ],
      link: { label: 'Review applicants', route: '/company/applicants' },
    }
  }
  const { data } = await api.get<Insights>('/admin/insights?range=30')
  return {
    title: 'Pending approvals and review',
    items: [
      { label: 'Company verifications', value: metricValue(data, 'pending_verifications') },
      { label: 'Job approvals', value: metricValue(data, 'job_queue') },
      { label: 'Open reports', value: metricValue(data, 'disputes') },
    ],
    link: { label: 'Open admin review', route: '/admin/verifications' },
  }
}
