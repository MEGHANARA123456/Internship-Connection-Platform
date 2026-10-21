import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { OpportunitiesPage } from '../StudentPages'

function CurrentPath() {
  return <div>{useLocation().pathname}</div>
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
        <Route path="/internships/:id" element={<CurrentPath />} />
        <Route path="/applications" element={<CurrentPath />} />
      </Routes>
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
    if (path === '/applications/student') {
      return { data: { counts: {}, applications: [application] } } as never
    }
    if (path.startsWith('/internships?')) {
      return { data: { items: [], total: 0 } } as never
    }
    return { data: [] } as never
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

describe('OpportunitiesPage Applied tab', () => {
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

  it('navigates to applications from Track application', async () => {
    renderOpportunities()
    fireEvent.click(screen.getByRole('button', { name: /Applied/ }))

    fireEvent.click(await screen.findByRole('button', { name: 'Track application' }))

    expect(await screen.findByText('/applications')).toBeTruthy()
  })
})
