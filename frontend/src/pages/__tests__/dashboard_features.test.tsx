import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

  it('opens and closes Visual Options & Actions menu and handles view switching, time ranges, and empty data exports', async () => {
    // Mock zero-activity / empty data analytics response
    vi.mocked(api.get).mockResolvedValueOnce({
      data: {
        role: 'STUDENT',
        has_activity: false,
        funnel: { applied: 0, screened: 0, interviews: 0, offers: 0 },
        domains: [],
        monthly_trends: [],
        total_active_internships: 0,
        total_verified_students: 0,
        total_companies: 0,
      },
    })

    // Mock clipboard and URL createObjectURL for exports
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => Promise.resolve()),
      },
    })
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    window.URL.revokeObjectURL = vi.fn()

    render(
      <BrowserRouter>
        <DesktopAnalysisVisuals
          variant="student"
          title="Career Journey & Opportunity Insights"
        />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Career Journey & Opportunity Insights')).toBeDefined()
    })

    // Initial funnel view rendered with 0 counts without error
    expect(screen.getByText('Pipeline Funnel')).toBeDefined()
    expect(screen.getAllByText('Applications Filed').length).toBeGreaterThan(0)

    // 1. Menu button is present and opens the dropdown
    const menuButton = screen.getByText('Options & Menu').closest('button')!
    expect(menuButton).toBeDefined()
    fireEvent.click(menuButton)

    // Dropdown is open
    await waitFor(() => {
      expect(screen.getByText('Visual Controls & Actions')).toBeDefined()
    })
    expect(screen.getByText('Quick View Switcher')).toBeDefined()
    expect(screen.getByText(/Time Range Filter/i)).toBeDefined()
    expect(screen.getByText(/Display Toggles/i)).toBeDefined()
    expect(screen.getByText(/Export & Snapshots/i)).toBeDefined()

    // 2. View Switcher - switch to Velocity Trends via dropdown
    const velocityBtn = screen.getByText('Velocity').closest('button')!
    fireEvent.click(velocityBtn)

    // Re-open menu to continue interacting
    fireEvent.click(menuButton)

    // 3. Time Range Filter - select Last 30 Days
    const thirtyDaysBtn = screen.getByText('Last 30 Days').closest('button')!
    fireEvent.click(thirtyDaysBtn)

    // 4. Export CSV button does not throw on empty data
    const exportCsvBtn = screen.getByText('Export Data to CSV').closest('button')!
    expect(() => fireEvent.click(exportCsvBtn)).not.toThrow()

    // 5. Copy summary button does not throw on empty data
    fireEvent.click(menuButton)
    const copySummaryBtn = screen.getByText('Copy Summary to Clipboard').closest('button')!
    expect(() => fireEvent.click(copySummaryBtn)).not.toThrow()

    // 6. Student role deep links are present
    fireEvent.click(menuButton)
    await waitFor(() => {
      expect(screen.getByText(/My Applications Pipeline/i)).toBeDefined()
    })
    expect(screen.getByText(/Saved Jobs & Bookmarks/i)).toBeDefined()
    expect(screen.getByText(/Skill Quizzes & Badges/i)).toBeDefined()

    // 7. Display Customization toggle test
    expect(screen.getByText('Conversion Percentages')).toBeDefined()
  })
})
