import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../../api/client'
import { ApplicationsPage } from '../StudentPages'
import { useAuthStore } from '../../store/auth'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  downloadAuthenticatedFile: vi.fn(),
  getFullMediaUrl: vi.fn(() => ''),
}))

const applications = [
  { id: 1, status: 'UNDER_REVIEW', internship_title: 'Role Review', created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', has_company_response: true, match_score: 55, response_time_hours: 5 },
  { id: 2, status: 'SHORTLISTED', internship_title: 'Role Shortlisted', created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z', has_company_response: false, match_score: 70, response_time_hours: null },
  { id: 3, status: 'SELECTED', internship_title: 'Role Offer', created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z', has_company_response: true, match_score: 95, response_time_hours: 1 },
  { id: 4, status: 'APPLIED', internship_title: 'Role Applied', created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z', has_company_response: false, match_score: 35, response_time_hours: null },
].map((application) => ({
  ...application,
  internship_id: application.id,
  student_id: 7,
  student_name: 'Test Student',
  student_skills: [],
  company_name: 'Test Company',
  company_id: 9,
  internship_status: 'PUBLISHED',
  cover_note: null,
  latest_status_from: null,
}))

afterEach(() => {
  vi.clearAllMocks()
  useAuthStore.getState().logout()
})

function setup(path: string) {
  useAuthStore.getState().setSession({
    accessToken: 'token',
    refreshToken: 'refresh',
    userId: 7,
    role: 'STUDENT',
    name: 'Test Student',
  })
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/applications/student') return { data: { applications } } as never
    if (url === '/notifications') return { data: [] } as never
    if (url === '/analytics/overview') {
      return { data: { role: 'STUDENT', has_activity: true, funnel: { applied: 4, screened: 2, interviews: 1, offers: 1 }, domains: [], monthly_trends: [], total_active_internships: 0, total_verified_students: 0, total_companies: 0 } } as never
    }
    return { data: [] } as never
  })
  return render(<MemoryRouter initialEntries={[path]}><ApplicationsPage /></MemoryRouter>)
}

function applicationRows() {
  return screen.getAllByRole('link', { name: /^Track application for/ })
}

describe('student analytics destination filters', () => {
  it('applies a status query and reports the filtered row count', async () => {
    setup('/applications?status=under_review')
    expect(await screen.findByText('Filtered by:')).toBeInTheDocument()
    expect(applicationRows()).toHaveLength(1)
    expect(applicationRows()[0]).toHaveAttribute('aria-label', 'Track application for Role Review')
  })

  it('filters to company-responded application records', async () => {
    setup('/applications?filter=responded')
    await waitFor(() => expect(applicationRows()).toHaveLength(2))
  })

  it('sorts all application rows by match score descending', async () => {
    setup('/applications?sort=match')
    await waitFor(() => expect(applicationRows()).toHaveLength(4))
    expect(applicationRows()[0]).toHaveAttribute('aria-label', 'Track application for Role Offer')
    expect(applicationRows()[1]).toHaveAttribute('aria-label', 'Track application for Role Shortlisted')
  })

  it('filters and sorts response time records, then clears URL filters', async () => {
    setup('/applications?filter=responded&sort=response_time')
    await waitFor(() => expect(applicationRows()).toHaveLength(2))
    expect(applicationRows()[0]).toHaveAttribute('aria-label', 'Track application for Role Offer')
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(applicationRows()).toHaveLength(4))
    expect(screen.queryByText('Filtered by:')).not.toBeInTheDocument()
  })
})
