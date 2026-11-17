import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { OpportunitiesPage } from '../StudentPages'

function CurrentUrl() {
  const location = useLocation()
  return <div data-testid="current-url">{location.pathname}{location.search}</div>
}

function BrowserBack() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>Browser Back</button>
}

const application = {
  id: 3,
  internship_id: 17,
  internship_title: 'Frontend Intern',
  company_name: 'Example Co',
  status: 'UNDER_REVIEW',
  created_at: '2026-06-01T12:00:00Z',
}

function renderOpportunities(initialPath = '/opportunities') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        <Route path="/opportunities/:id" element={<OpportunitiesPage />} />
        <Route path="/internships/:id" element={<CurrentUrl />} />
        <Route path="/applications" element={<CurrentUrl />} />
      </Routes>
      <CurrentUrl />
      <BrowserBack />
    </MemoryRouter>
  )
}

beforeEach(() => {
  useAuthStore.getState().setSession({
    accessToken: 'test-token',
    refreshToken: 'test-refresh-token',
    userId: 1,
    role: 'STUDENT',
    email: 'student@example.com',
    name: 'Student Name',
  })
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path.startsWith('/applications/student')) {
      return { data: { counts: {}, applications: [application] } } as never
    }
    if (path === '/applications/3/timeline') {
      return {
        data: {
          summary: { ...application, title: application.internship_title },
          steps: [
            { key: 'APPLIED', label: 'Applied', state: 'done', timestamp: '2026-06-01T12:00:00Z' },
            { key: 'UNDER_REVIEW', label: 'Application viewed', state: 'current', timestamp: '2026-06-02T12:00:00Z' },
          ],
        },
      } as never
    }
    if (path.startsWith('/internships?')) {
      return { data: { items: [], total: 0 } } as never
    }
    if (path === '/internships/17') {
      return {
        data: {
          id: 17,
          title: 'Frontend Intern',
          company_name: 'Example Co',
          industry: 'Software',
          location: 'Remote',
          description: 'Frontend role details.',
          stipend: 1000,
          duration_months: 3,
          work_mode: 'REMOTE',
          skills: [],
        },
      } as never
    }
    return { data: [] } as never
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

describe('OpportunitiesPage Applied tab', () => {
  it('shows stipend values in INR on opportunity cards and details', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path.startsWith('/internships?')) {
        return {
          data: {
            items: [{
              id: 42,
              title: 'Frontend Intern',
              status: 'PUBLISHED',
              company_name: 'Example Co',
              industry: 'Software',
              location: 'Remote',
              description: 'Build accessible web applications.',
              stipend: 15000,
              duration_months: 3,
              work_mode: 'REMOTE',
              skills: [],
            }],
            total: 1,
          },
        } as never
      }
      if (path === '/applications/student') return { data: { counts: {}, applications: [] } } as never
      return { data: [] } as never
    })

    renderOpportunities()
    const stipend = await screen.findByText('₹15,000/mo')
    expect(stipend).toBeInTheDocument()
    fireEvent.click(stipend)
    expect(await screen.findAllByText('₹15,000/mo')).toHaveLength(2)
  })

  it('renders for students', () => {
    renderOpportunities()
    expect(screen.getByRole('button', { name: /Applied/ })).toBeTruthy()
  })

  it.each(['COMPANY', 'ADMIN'] as const)('does not render for %s users', (role) => {
    useAuthStore.getState().setSession({
      accessToken: 'company-token',
      refreshToken: 'company-refresh-token',
      userId: 2,
      role,
      email: `${role.toLowerCase()}@example.com`,
      name: role,
    })
    renderOpportunities()
    expect(screen.queryByRole('button', { name: /Applied/ })).toBeNull()
  })

  it('loads application titles and statuses when selected', async () => {
    renderOpportunities()

    fireEvent.click(screen.getByRole('button', { name: /Applied/ }))

    expect(await screen.findByText('Frontend Intern')).toBeTruthy()
    expect(screen.getByText('UNDER_REVIEW')).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('/applications/student')
    expect(screen.getByText(/Applied on/)).toBeTruthy()
  })

  it('marks closed applications in the Applied tab', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/student') {
        return { data: { counts: {}, applications: [{ ...application, internship_status: 'CLOSED' }] } } as never
      }
      if (path.startsWith('/internships?')) {
        return { data: { items: [], total: 0 } } as never
      }
      return { data: [] } as never
    })
    renderOpportunities()
    fireEvent.click(screen.getByRole('button', { name: /Applied/ }))

    expect(await screen.findByText('ROLE CLOSED')).toBeTruthy()
  })

  it('shows a closed saved role and disables its Apply button', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/internships/saved') {
        return {
          data: [{
            id: 17,
            title: 'Closed Frontend Intern',
            status: 'CLOSED',
            company_name: 'Example Co',
            industry: 'Software',
            location: 'Remote',
            description: 'A closed role retained in saved internships.',
            stipend: 1000,
            duration_months: 3,
            work_mode: 'REMOTE',
            skills: [],
          }],
        } as never
      }
      if (path === '/applications/student') {
        return { data: { counts: {}, applications: [] } } as never
      }
      if (path.startsWith('/internships?')) {
        return { data: { items: [], total: 0 } } as never
      }
      return { data: [] } as never
    })
    renderOpportunities()
    fireEvent.click(screen.getByRole('button', { name: /Saved Roles/ }))

    expect(await screen.findByText('Closed')).toBeTruthy()
    const applyButton = screen.getByRole('button', { name: 'Apply Now' })
    expect(applyButton).toBeDisabled()
    expect(applyButton).toHaveAttribute('title', 'This internship is closed and no longer accepts applications.')
  })

  it('filters every saved role by status and updates counts when a role is unsaved', async () => {
    const savedRoles = [
      {
        id: 21,
        title: 'Shortlisted Intern',
        status: 'PUBLISHED',
        availability: 'OPEN',
        application_id: 201,
        application_status: 'SHORTLISTED',
        is_saved: true,
        company_name: 'Example Co',
        industry: 'Software',
        location: 'Remote',
        description: 'An applied role.',
        stipend: 1000,
        duration_months: 3,
        work_mode: 'REMOTE',
        skills: [],
      },
      {
        id: 22,
        title: 'Expired Intern',
        status: 'PUBLISHED',
        availability: 'EXPIRED',
        is_saved: true,
        company_name: 'Example Co',
        industry: 'Software',
        location: 'Remote',
        description: 'An expired role.',
        stipend: 1000,
        duration_months: 3,
        work_mode: 'REMOTE',
        skills: [],
      },
      {
        id: 23,
        title: 'Open Intern',
        status: 'PUBLISHED',
        availability: 'OPEN',
        is_saved: true,
        company_name: 'Example Co',
        industry: 'Software',
        location: 'Remote',
        description: 'An open role.',
        stipend: 1000,
        duration_months: 3,
        work_mode: 'REMOTE',
        skills: [],
      },
    ]
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/internships/saved') return { data: savedRoles } as never
      if (path === '/internships/saved/summary') {
        return { data: { total: 3, open: 1, applied: 1, closed: 1 } } as never
      }
      if (path.startsWith('/internships?')) return { data: { items: [], total: 0 } } as never
      return { data: [] } as never
    })
    vi.spyOn(api, 'delete').mockResolvedValue({ data: { is_saved: false } } as never)

    renderOpportunities()
    fireEvent.click(screen.getByRole('button', { name: /Saved Roles/ }))

    expect(await screen.findByText('Shortlisted Intern')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All 3' })).toBeInTheDocument()
    expect(screen.getByText('Applied · Shortlisted')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute('href', '/applications?id=201')
    const applyButtons = screen.getAllByRole('button', { name: 'Apply Now' })
    expect(applyButtons.some((button) => !button.hasAttribute('disabled'))).toBe(true)
    expect(applyButtons.some((button) => button.hasAttribute('disabled'))).toBe(true)
    expect(screen.getByText('Expired')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Open 1/ }))
    expect(screen.getByText('Open Intern')).toBeInTheDocument()
    expect(screen.queryByText('Expired Intern')).not.toBeInTheDocument()
    expect(screen.queryByText('Shortlisted Intern')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Closed & expired 1/ }))
    expect(screen.getByText('Expired Intern')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Remove from saved'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument())
    expect(screen.queryByText('Expired Intern')).not.toBeInTheDocument()
  })

  it('marks a saved role as applied immediately after submission', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/internships/saved') {
        return {
          data: [{
            id: 23,
            title: 'Open Intern',
            status: 'PUBLISHED',
            availability: 'OPEN',
            is_saved: true,
            company_name: 'Example Co',
            industry: 'Software',
            location: 'Remote',
            description: 'An open role.',
            stipend: 1000,
            duration_months: 3,
            work_mode: 'REMOTE',
            skills: [],
          }],
        } as never
      }
      if (path === '/internships/saved/summary') {
        return { data: { total: 1, open: 1, applied: 0, closed: 0 } } as never
      }
      if (path === '/applications/eligibility/23') {
        return {
          data: {
            can_apply: true,
            blockers: [],
            warnings: [],
            match_score: 78,
            matched_skills: [],
            missing_skills: [],
            resume: { filename: 'resume.pdf', uploaded_at: null },
          },
        } as never
      }
      if (path.startsWith('/internships?')) return { data: { items: [], total: 0 } } as never
      return { data: { applications: [] } } as never
    })
    vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 203 } } as never)

    renderOpportunities()
    fireEvent.click(screen.getByRole('button', { name: /Saved Roles/ }))
    const roleCard = (await screen.findByText('Open Intern')).closest('.cursor-pointer')
    expect(roleCard).not.toBeNull()
    fireEvent.click(within(roleCard as HTMLElement).getByRole('button', { name: 'Apply Now' }))

    await screen.findByText('Review internship')
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit Application' }))

    expect(await screen.findByText('Applied', { selector: '.glass-badge' })).toBeInTheDocument()
    expect(within(roleCard as HTMLElement).getByRole('link', { name: 'View application' })).toHaveAttribute('href', '/applications?id=203')
    expect(screen.getByRole('button', { name: 'Open 0' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Applied 1' })).toBeInTheDocument()
  })

  it('opens a closed role by direct link in read-only mode', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/internships/17') {
        return {
          data: {
            id: 17,
            title: 'Closed Frontend Intern',
            status: 'CLOSED',
            company_name: 'Example Co',
            industry: 'Software',
            location: 'Remote',
            description: 'A role that remains readable after closure.',
            stipend: 1000,
            duration_months: 3,
            work_mode: 'REMOTE',
            skills: [],
          },
        } as never
      }
      if (path === '/applications/student') {
        return { data: { counts: {}, applications: [] } } as never
      }
      if (path.startsWith('/internships?')) {
        return { data: { items: [], total: 0 } } as never
      }
      return { data: [] } as never
    })

    render(
      <MemoryRouter initialEntries={['/internships/17']}>
        <Routes>
          <Route path="/internships/:id" element={<OpportunitiesPage />} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('This internship is closed to new applications. This listing is available for reference only.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Apply Now' })).toBeDisabled()
  })

  it('shows the empty state when the application list is empty', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/applications/student') {
        return { data: { counts: {}, applications: [] } } as never
      }
      if (path.startsWith('/internships?')) {
        return { data: { items: [], total: 0 } } as never
      }
      return { data: [] } as never
    })

    renderOpportunities()
    fireEvent.click(screen.getByRole('button', { name: /Applied/ }))

    expect(await screen.findByText('No applications yet')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'All Opportunities' })[1])
    await waitFor(() => expect(screen.queryByText('No applications yet')).toBeNull())
  })

  it('keeps the Applied tab behind View details and returns to it when closed', async () => {
    renderOpportunities('/opportunities?tab=applied&q=frontend')
    await screen.findByRole('button', { name: 'View details' })
    fireEvent.click(screen.getByRole('button', { name: 'View details' }))

    expect(await screen.findByText('Frontend role details.')).toBeInTheDocument()
    expect(screen.getByTestId('current-url')).toHaveTextContent('/opportunities/17?tab=applied&q=frontend')
    expect(screen.getByRole('button', { name: /Applied/ })).toHaveClass('bg-indigo-600')
    expect(screen.getAllByText('Frontend Intern').length).toBeGreaterThan(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => expect(screen.getByTestId('current-url')).toHaveTextContent('/opportunities?tab=applied&q=frontend'))
    expect(await screen.findByRole('button', { name: 'View details' })).toBeInTheDocument()
  })

  it('reads the Applied tab from the URL when a details route is loaded directly', async () => {
    renderOpportunities('/opportunities/17?tab=applied')
    expect(await screen.findByText('Frontend role details.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'View details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Applied/ })).toHaveClass('bg-indigo-600')
  })

  it('closes the details modal with browser Back', async () => {
    renderOpportunities('/opportunities?tab=applied')
    fireEvent.click(await screen.findByRole('button', { name: 'View details' }))
    expect(await screen.findByText('Frontend role details.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }))

    await waitFor(() => expect(screen.getByTestId('current-url')).toHaveTextContent('/opportunities?tab=applied'))
    expect(screen.queryByText('Frontend role details.')).not.toBeInTheDocument()
  })

  it('opens the tracker in place and renders completed, current, and pending stages', async () => {
    renderOpportunities('/opportunities?tab=applied')
    fireEvent.click(screen.getByRole('button', { name: /Applied/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Track application' }))

    expect(await screen.findByRole('heading', { name: 'Application tracker' })).toBeInTheDocument()
    expect(screen.getByTestId('current-url')).toHaveTextContent('/opportunities?tab=applied&track=3')
    expect(api.get).toHaveBeenCalledWith('/applications/3/timeline')
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    expect(screen.getByText('Application viewed')).toBeInTheDocument()
  })

  it('shows a rejected final step and leaves later stages pending', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/student') return { data: { applications: [{ ...application, status: 'REJECTED', last_reached_status: 'UNDER_REVIEW' }] } } as never
      if (path === '/applications/3/timeline') return {
        data: {
          summary: { ...application, status: 'REJECTED', last_reached_status: 'UNDER_REVIEW' },
          steps: [
            { key: 'APPLIED', label: 'Applied', state: 'done', timestamp: '2026-06-01T12:00:00Z' },
            { key: 'UNDER_REVIEW', label: 'Application viewed', state: 'done', timestamp: '2026-06-02T12:00:00Z' },
          ],
        },
      } as never
      if (path.startsWith('/internships?')) return { data: { items: [], total: 0 } } as never
      return { data: [] } as never
    })
    renderOpportunities('/opportunities?tab=applied')
    fireEvent.click(await screen.findByRole('button', { name: 'Track application' }))

    expect(await screen.findByText('Not selected')).toBeInTheDocument()
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    expect(screen.getByText('Rejected')).toBeInTheDocument()
  })

  it('shows all stages completed for an accepted offer', async () => {
    vi.mocked(api.get).mockImplementation(async (path) => {
      if (path === '/applications/student') return { data: { applications: [{ ...application, status: 'ACCEPTED' }] } } as never
      if (path === '/applications/3/timeline') return {
        data: { summary: { ...application, status: 'ACCEPTED' }, steps: [] },
      } as never
      if (path.startsWith('/internships?')) return { data: { items: [], total: 0 } } as never
      return { data: [] } as never
    })
    renderOpportunities('/opportunities?tab=applied')
    fireEvent.click(await screen.findByRole('button', { name: 'Track application' }))

    expect(await screen.findByText('Offer Accepted')).toBeInTheDocument()
    expect(screen.getAllByText('Completed')).toHaveLength(5)
  })

  it('closes on Escape, removes the tracker query, and restores focus to its button', async () => {
    renderOpportunities('/opportunities?tab=applied')
    const trackButton = await screen.findByRole('button', { name: 'Track application' })
    trackButton.focus()
    fireEvent.click(trackButton)
    await screen.findByRole('heading', { name: 'Application tracker' })

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(screen.getByTestId('current-url')).toHaveTextContent('/opportunities?tab=applied'))
    expect(document.activeElement).toBe(trackButton)
  })

  it('closes the tracker with browser Back', async () => {
    renderOpportunities('/opportunities?tab=applied')
    fireEvent.click(await screen.findByRole('button', { name: 'Track application' }))
    expect(await screen.findByRole('heading', { name: 'Application tracker' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }))

    await waitFor(() => expect(screen.getByTestId('current-url')).toHaveTextContent('/opportunities?tab=applied'))
    expect(screen.queryByRole('heading', { name: 'Application tracker' })).not.toBeInTheDocument()
  })

  it('uses the vertical stepper layout on narrow viewports', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    renderOpportunities('/opportunities?tab=applied')
    fireEvent.click(await screen.findByRole('button', { name: 'Track application' }))
    await screen.findByRole('heading', { name: 'Application tracker' })

    expect(screen.getByRole('list', { name: 'Application progress' })).toHaveClass('flex-col', 'sm:flex-row')
  })
})
