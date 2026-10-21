import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { CompanyPerformanceCharts, StudentInsightsCharts } from './AnalyticsInsights'
import { DesktopAnalysisVisuals } from './DesktopAnalysisVisuals'
import { BrowserRouter } from 'react-router-dom'

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
  },
}))

const performanceData = {
  by_role: [{
    internship_id: 1,
    title: 'Frontend Intern',
    applications: 4,
    shortlisted: 2,
    offers: 1,
    accepted: 1,
  }],
  status_distribution: [{ status: 'APPLIED', count: 4 }],
  time_metrics: {
    avg_hours_to_first_response: 12,
    avg_days_to_offer: 5,
    sample_size: 2,
    offer_sample_size: 1,
  },
  match_distribution: [{ bucket: '50-69', count: 4 }],
  match_distribution_sample_size: 4,
  top_skills: [{ skill: 'TypeScript', applicants: 3, required_by_roles: 1 }],
  top_universities: [{ university: 'North University', applicants: 2 }],
  interview_outcomes: { scheduled: 1, completed: 0, cancelled: 0 },
  offer_acceptance_rate: 100,
  offer_sample_size: 1,
  total_applications: 4,
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('CompanyPerformanceCharts', () => {
  it('shows chart skeletons until the request resolves, then renders live data', async () => {
    let resolveRequest: ((value: { data: typeof performanceData }) => void) | undefined
    vi.mocked(api.get).mockImplementationOnce(
      () => new Promise((resolve) => { resolveRequest = resolve }),
    )

    render(<CompanyPerformanceCharts range="30" />)
    expect(screen.getAllByRole('status', { name: 'Loading chart' }).length).toBeGreaterThan(0)

    resolveRequest?.({ data: performanceData })
    expect((await screen.findAllByText('Frontend Intern')).length).toBeGreaterThan(0)
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    expect(screen.getByText('North University')).toBeInTheDocument()
    expect(screen.getByText('12 hrs')).toBeInTheDocument()
  })

  it('shows Retry on failure and keeps the existing pipeline chart available', async () => {
    let performanceCalls = 0
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/analytics/overview') {
        return {
          data: {
            role: 'COMPANY',
            has_activity: true,
            funnel: { applied: 4, screened: 2, interviews: 1, offers: 1 },
            domains: [],
            monthly_trends: [],
            total_active_internships: 1,
            total_verified_students: 4,
            total_companies: 1,
          },
        }
      }
      performanceCalls += 1
      if (performanceCalls === 1) throw new Error('performance unavailable')
      return { data: performanceData }
    })

    render(<BrowserRouter><DesktopAnalysisVisuals variant="company" /></BrowserRouter>)
    expect(await screen.findByRole('button', { name: 'Analytics view: Pipeline Funnel' })).toBeInTheDocument()
    const retryButtons = await screen.findAllByRole('button', { name: 'Retry' })
    expect(retryButtons.length).toBeGreaterThan(1)
    expect(screen.getAllByText("Couldn't load this chart.").length).toBeGreaterThan(0)

    fireEvent.click(retryButtons[0])
    await waitFor(() => expect(screen.getAllByText('Frontend Intern').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Analytics view: Pipeline Funnel' })).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/analytics/company/performance?range=30')
  })
})

describe('StudentInsightsCharts', () => {
  it('renders the student status, weekly activity, and skills gap from returned data', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        status_distribution: [{ status: 'SHORTLISTED', count: 2 }],
        weekly_applications: [{
          week_start: '2026-10-05',
          applications: 2,
        }],
        response_rate: 50,
        response_sample_size: 4,
        responded_applications: 2,
        avg_match_score: 78,
        match_sample_size: 4,
        skills_gap: [{ skill: 'SQL', missing_count: 2 }],
        avg_response_hours: 24,
        response_time_sample_size: 2,
        total_applications: 4,
      },
    })

    render(<StudentInsightsCharts />)
    expect(screen.getAllByRole('status', { name: 'Loading chart' }).length).toBeGreaterThan(0)
    expect(await screen.findByText('SQL')).toBeInTheDocument()
    expect(screen.getByText('Missing in 2 roles')).toBeInTheDocument()
    expect(screen.getByText('78%')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /My application status distribution/ })).toBeInTheDocument()
  })
})
