import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DesktopAnalysisVisuals } from '../../components/analytics/DesktopAnalysisVisuals'
import { CompanyJobsPage } from '../CompanyPages'
import { AdminDashboardPage } from '../AdminPages'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'

// Mock API
vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  downloadAuthenticatedFile: vi.fn(),
  getFullMediaUrl: (url: string) => url,
}))

describe('Dashboard Features & Buttons', () => {
  it('renders DesktopAnalysisVisuals with a working Refresh button on analysis top', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        role: 'ADMIN',
        has_activity: true,
        funnel: { applied: 10, screened: 5, interviews: 3, offers: 1 },
        domains: [],
        monthly_trends: [],
        total_active_internships: 5,
        total_verified_students: 20,
        total_companies: 4,
      },
    })

    render(
      <BrowserRouter>
        <DesktopAnalysisVisuals
          variant="admin"
          title="Platform Ecosystem & Placement Analytics"
        />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Platform Ecosystem & Placement Analytics')).toBeDefined()
    })

    // Dedicated refresh button on the top header of the analysis component
    const refreshBtn = screen.getByRole('button', { name: /refresh/i })
    expect(refreshBtn).toBeDefined()
  })

  it('renders CompanyJobsPage with the Interview Scheduling button in header and job cards', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/internships/mine') {
        return {
          data: [
            {
              id: 101,
              title: 'Full Stack Engineering Intern',
              status: 'PUBLISHED',
              work_mode: 'REMOTE',
              industry: 'Software',
              location: 'San Francisco, CA',
              stipend: 2000,
              duration_months: 3,
            },
          ],
        }
      }
      if (url === '/analytics/overview') {
        return {
          data: {
            role: 'COMPANY',
            has_activity: true,
            funnel: { applied: 2, screened: 1, interviews: 1, offers: 0 },
            domains: [],
            monthly_trends: [],
            total_active_internships: 1,
            total_verified_students: 10,
            total_companies: 1,
          },
        }
      }
      return { data: [] }
    })

    useAuthStore.setState({
      session: {
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        role: 'COMPANY',
        userId: 2,
        name: 'Tech Corp',
      },
    })

    render(
      <BrowserRouter>
        <CompanyJobsPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Internship Postings')).toBeDefined()
    })

    // Interview Scheduling button in header and on the job card
    const interviewButtons = screen.getAllByRole('button', { name: /Interview Scheduling/i })
    expect(interviewButtons.length).toBeGreaterThanOrEqual(2)
  })

  it('renders AdminDashboardPage with the Refresh button on top', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/health') return { data: { status: 'ok' } }
      if (url === '/admin/users') return { data: [] }
      if (url === '/admin/companies/unverified') return { data: [] }
      if (url === '/admin/internships') return { data: [] }
      if (url === '/admin/reports') return { data: [] }
      if (url === '/analytics/overview') return { data: { funnel: { applied: 0, screened: 0, interviews: 0, offers: 0 } } }
      return { data: [] }
    })

    useAuthStore.setState({
      session: {
        accessToken: 'mock-token',
        refreshToken: 'mock-refresh',
        role: 'ADMIN',
        userId: 1,
        name: 'Super Admin',
      },
    })

    render(
      <BrowserRouter>
        <AdminDashboardPage />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Platform Admin Console')).toBeDefined()
    })

    // Top dashboard refresh button
    const refreshButtons = screen.getAllByRole('button', { name: /refresh/i })
    expect(refreshButtons.length).toBeGreaterThan(0)
  })
})
