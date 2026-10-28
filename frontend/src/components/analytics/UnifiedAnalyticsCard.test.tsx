import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
import { api } from '../../api/client'
import { UnifiedAnalyticsCard } from './UnifiedAnalyticsCard'

vi.mock('../../api/client', () => ({ api: { get: vi.fn() } }))

const studentData = {
  range: '30',
  sample_size: 4,
  has_data: true,
  funnel: [
    { stage: 'Applications', count: 4, conversion_pct: null, dropoff_pct: null },
    { stage: 'Screened', count: 3, conversion_pct: 75, dropoff_pct: 25 },
    { stage: 'Interview stage', count: 2, conversion_pct: 66.7, dropoff_pct: 33.3 },
    { stage: 'Offers', count: 1, conversion_pct: 50, dropoff_pct: 50 },
  ],
  activity_trend: [{ date: '2026-10-12', applications: 2, interviews: 1, offers: 0 }],
  status_breakdown: [{ status: 'SHORTLISTED', count: 2 }, { status: 'APPLIED', count: 2 }],
  domains: [{ name: 'Software', count: 3 }],
  work_modes: [{ name: 'REMOTE', count: 3 }, { name: 'HYBRID', count: 1 }],
  match_score_distribution: [{ bucket: '50-69', count: 3 }, { bucket: '70-84', count: 1 }],
  kpis: {
    applications_submitted: { value: 4, sample_size: 4, definition: 'Count of applications.' },
    under_review: { value: 1, sample_size: 4, definition: 'Current UNDER_REVIEW status.' },
    shortlisted: { value: 2, sample_size: 4, definition: 'Current SHORTLISTED status.' },
    offers: { value: 1, sample_size: 4, definition: 'SELECTED and ACCEPTED statuses.' },
    interviews_scheduled: { value: 2, sample_size: 2, definition: 'Scheduled interviews.' },
    saved_roles: { value: 1, sample_size: 1, definition: 'Saved internship rows.' },
    response_rate: { value: 50, sample_size: 4, numerator: 2, denominator: 4, definition: 'Responded applications / applications.' },
    average_match_score: { value: 78, sample_size: 4, definition: 'Mean match score.' },
    recruiter_response_time: { value: 217, sample_size: 2, definition: 'Mean elapsed time.' },
  },
}

const emptyData = {
  ...studentData,
  sample_size: 0,
  has_data: false,
  funnel: [
    { stage: 'Applications', count: 0, conversion_pct: null, dropoff_pct: null },
    { stage: 'Screened', count: 0, conversion_pct: null, dropoff_pct: null },
    { stage: 'Interview stage', count: 0, conversion_pct: null, dropoff_pct: null },
    { stage: 'Offers', count: 0, conversion_pct: null, dropoff_pct: null },
  ],
  activity_trend: [],
  status_breakdown: [],
  domains: [],
  work_modes: [],
  match_score_distribution: [],
  kpis: Object.fromEntries(Object.entries(studentData.kpis).map(([key, metric]) => [
    key,
    { ...metric, value: null, sample_size: 0 },
  ])),
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function renderCard(variant: 'student' | 'company' | 'admin' = 'student') {
  return render(
    <BrowserRouter>
      <UnifiedAnalyticsCard variant={variant} title={`${variant} analytics`} />
    </BrowserRouter>,
  )
}

describe('UnifiedAnalyticsCard', () => {
  it('offers assessment links for known missing skills in the student skill-gap chart', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...studentData,
        charts: {
          skill_gap: [
            { name: 'Python', have: 0, missing: 2 },
            { name: 'React', have: 1, missing: 0 },
            { name: 'SQL', have: 0, missing: 1 },
          ],
        },
      },
    })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: /Show: All charts/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Insights' }))

    expect(await screen.findByRole('link', { name: 'Take assessment: Python' }))
      .toHaveAttribute('href', '/profile/student?assessment=python')
    expect(screen.getByRole('link', { name: 'Take assessment: SQL' }))
      .toHaveAttribute('href', '/profile/student?assessment=sql')
    expect(screen.queryByRole('link', { name: 'Take assessment: React' })).not.toBeInTheDocument()
  })

  it('renders the active student KPI links with matching data routes and sample sizes', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: studentData })
    renderCard()

    expect(await screen.findByRole('link', { name: /Applications submitted: 4/ })).toHaveAttribute('href', '/applications')
    expect(screen.getByRole('link', { name: /Interviews scheduled: 2/ })).toHaveAttribute('href', '/interviews?tab=upcoming')
    expect(screen.getByRole('link', { name: /Saved roles: 1/ })).toHaveAttribute('href', '/saved')
    expect(screen.getByRole('link', { name: /Average match score: 78%/ })).toHaveAttribute('href', '/applications?sort=match')
    expect(screen.getByRole('link', { name: /View 1 under review applications/ })).toHaveAttribute('href', '/applications?status=under_review')
    expect(screen.getByRole('link', { name: /View 2 shortlisted applications/ })).toHaveAttribute('href', '/applications?status=shortlisted')
    expect(screen.getByRole('link', { name: /View 1 offers applications/ })).toHaveAttribute('href', '/applications?status=selected')
    expect(screen.getByText('Based on 4 applications')).toBeInTheDocument()
    expect(screen.queryByText('Low sample')).not.toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/students/me/insights?range=30')
  })

  it('shows Recharts panels and switches to a keyboard-operable focus view', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: studentData })
    renderCard()

    expect(await screen.findByRole('heading', { name: 'Application funnel' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Match score distribution' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show: All charts/ }))
    const menu = screen.getByRole('menu', { name: 'Analytics chart focus' })
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Trends' }))
    expect(screen.getByRole('heading', { name: 'Activity trend' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Application funnel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Match score distribution' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View as table' })).toBeInTheDocument()
  })

  it('shows honest empty metric and chart states instead of fabricated zeros', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: emptyData })
    renderCard()

    expect(await screen.findAllByText('No data yet')).not.toHaveLength(0)
    expect(screen.getAllByText('Not enough data yet').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Applications submitted: -/ })).toBeInTheDocument()
  })

  it.each([
    ['company', '/companies/me/insights?range=30'],
    ['admin', '/admin/insights?range=30'],
  ] as const)('uses real role data and omits the student-only match chart for %s', async (variant, expectedPath) => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...studentData, kpis: undefined } })
    renderCard(variant)

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expectedPath))
    const domainTitle = variant === 'admin' ? 'Internships by domain' : 'Roles by domain'
    expect(await screen.findByRole('heading', { name: domainTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Match score distribution' })).not.toBeInTheDocument()
  })
})
