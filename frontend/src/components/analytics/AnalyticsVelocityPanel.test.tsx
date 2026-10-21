import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { DesktopAnalysisVisuals } from './DesktopAnalysisVisuals'
import { formatDuration } from './AnalyticsInsights'

vi.mock('../../api/client', () => ({ api: { get: vi.fn() } }))

const overview = {
  role: 'STUDENT',
  has_activity: true,
  funnel: { applied: 4, screened: 2, interviews: 1, offers: 1 },
  domains: [],
  monthly_trends: [{ month: 'Oct', apps: 4, interviews: 1, offers: 1 }],
  total_active_internships: 0,
  total_verified_students: 0,
  total_companies: 0,
}

const companyPerformance = {
  by_role: [{ internship_id: 1, title: 'Frontend Intern', applications: 4, shortlisted: 2, offers: 1, accepted: 1 }],
  status_distribution: [{ status: 'APPLIED', count: 4 }],
  time_metrics: { avg_hours_to_first_response: 217, avg_days_to_offer: 5, sample_size: 2, offer_sample_size: 1 },
  match_distribution: [{ bucket: '50-69', count: 4 }],
  match_distribution_sample_size: 4,
  top_skills: [{ skill: 'TypeScript', applicants: 3, required_by_roles: 1 }],
  top_universities: [{ university: 'North University', applicants: 2 }],
  interview_outcomes: { scheduled: 1, completed: 1, cancelled: 0 },
  offer_acceptance_rate: 50,
  offer_sample_size: 2,
  total_applications: 4,
}

const companyInsights = {
  role: 'company',
  range: '30',
  sample_size: 4,
  period_label: 'Last 30 days',
  has_data: true,
  funnel: [
    { stage: 'Applications', count: 4, conversion_pct: null, dropoff_pct: null },
    { stage: 'Screened', count: 2, conversion_pct: 50, dropoff_pct: 50 },
    { stage: 'Interview stage', count: 1, conversion_pct: 50, dropoff_pct: 50 },
    { stage: 'Offers', count: 1, conversion_pct: 100, dropoff_pct: 0 },
  ],
  activity_trend: [{ date: '2026-10-14', applications: 2, interviews: 1, offers: 0 }],
  status_breakdown: [{ status: 'APPLIED', count: 4 }],
  domains: [{ name: 'Software Development', count: 4 }],
  work_modes: [],
  charts: {
    company_pipeline: [{ name: 'Applied', count: 4 }, { name: 'Under review', count: 2 }, { name: 'Shortlisted', count: 2 }, { name: 'Interview', count: 1 }, { name: 'Selected', count: 1 }],
    conversion_by_role: [{ name: 'Frontend Intern', count: 4, applied: 4, under_review: 2, shortlisted: 2, interview_scheduled: 1, selected: 1, accepted: 1 }],
    applicants_by_posting: [{ id: 1, name: 'Frontend Intern', count: 4 }],
    applications_over_time: [{ name: 'Oct 14', date: '2026-10-14', count: 2, applications: 2 }],
    top_skills: [{ name: 'TypeScript', count: 3 }],
    top_universities: [{ name: 'North University', count: 2 }],
  },
  chart_samples: {},
  kpis: {
    active_roles: { value: 1, sample_size: 1, definition: 'Active roles.' },
    total_applicants: { value: 4, sample_size: 4, definition: 'Applicants.' },
    shortlisted: { value: 2, sample_size: 4, definition: 'Shortlisted.' },
    interviews_scheduled: { value: 1, sample_size: 1, definition: 'Upcoming interviews.' },
    offers: { value: 1, sample_size: 4, definition: 'Offers.' },
  },
}

const studentInsights = {
  status_distribution: [{ status: 'SHORTLISTED', count: 2 }],
  weekly_applications: [{ week_start: '2026-10-05', applications: 2 }],
  response_rate: 50,
  response_sample_size: 4,
  responded_applications: 2,
  avg_match_score: 78,
  match_sample_size: 4,
  skills_gap: [{ skill: 'SQL', missing_count: 2 }],
  avg_response_hours: 217,
  response_time_sample_size: 2,
  total_applications: 4,
}

afterEach(() => {
  vi.clearAllMocks()
  window.sessionStorage.clear()
  useAuthStore.getState().logout()
})

function setupApi() {
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path === '/analytics/overview') return { data: overview } as never
    if (String(path).startsWith('/analytics/company/performance')) return { data: companyPerformance } as never
    if (String(path).startsWith('/companies/me/insights')) return { data: companyInsights } as never
    if (path === '/analytics/student/insights') return { data: studentInsights } as never
    if (path === '/analytics/admin/user-growth?granularity=month&periods=6') {
      return { data: [{ period: 'Oct', students: 4, companies: 2, admins: 1 }] } as never
    }
    if (path === '/analytics/admin/admin-action-volume?days=14') {
      return { data: [{ period: 'Oct 14', action: 'user_suspended', count: 3 }, { period: 'Oct 14', action: 'user_suspended', count: 2 }] } as never
    }
    return { data: [] } as never
  })
}

describe('analytics velocity panel', () => {
  it('formats durations with readable day and hour units', () => {
    expect(formatDuration(47)).toBe('47 h')
    expect(formatDuration(217)).toBe('9 d 1 h')
    expect(formatDuration(48)).toBe('2 d')
  })

  it('offers company charts, switches the selected chart, and renders the complete KPI row', async () => {
    setupApi()
    useAuthStore.getState().setSession({ accessToken: 'token', refreshToken: 'refresh', userId: 17, role: 'COMPANY' })
    render(<BrowserRouter><DesktopAnalysisVisuals variant="company" fullAnalyticsMenu /></BrowserRouter>)
    expect(await screen.findByRole('heading', { name: 'Status Per Application' })).toBeInTheDocument()
    const selector = screen.getByRole('button', { name: /Show: All charts/ })
    fireEvent.click(selector)
    const menu = screen.getByRole('menu', { name: 'Analytics chart focus' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Trends' })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Trends' }))
    expect(await screen.findByRole('heading', { name: 'Applications over time' })).toBeInTheDocument()
    for (const label of ['Active roles', 'Total applicants', 'Shortlisted', 'Interviews scheduled', 'Offers']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('limits student and admin menus to their own charts', async () => {
    setupApi()
    useAuthStore.getState().setSession({ accessToken: 'token', refreshToken: 'refresh', userId: 18, role: 'STUDENT' })
    const { unmount } = render(<BrowserRouter><DesktopAnalysisVisuals variant="student" fullAnalyticsMenu /></BrowserRouter>)
    expect(await screen.findByRole('heading', { name: 'Application funnel' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Roles by domain' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Internships by status' })).not.toBeInTheDocument()
    unmount()

    useAuthStore.getState().setSession({ accessToken: 'admin-token', refreshToken: 'refresh', userId: 19, role: 'ADMIN' })
    render(<BrowserRouter><DesktopAnalysisVisuals variant="admin" fullAnalyticsMenu /></BrowserRouter>)
    expect(await screen.findByRole('heading', { name: 'Signups over time' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Admin actions by type' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Application funnel' })).not.toBeInTheDocument()
  })
})
