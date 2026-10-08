import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { LoginPage } from './pages/AuthPages'
import { api } from './api/client'
import { useAuthStore } from './store/auth'

function CurrentPath() {
  return <div>{useLocation().pathname}</div>
}

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

describe('platform shell', () => {
  it('renders the recruitment landing shell with InternSphere branding', () => {
    render(<BrowserRouter><App /></BrowserRouter>)
    expect(screen.getAllByText('Intern').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sphere').length).toBeGreaterThan(0)
    expect(screen.getByText('Browse Internships')).toBeTruthy()
  })

  it('renders the login form', () => {
    render(<BrowserRouter><LoginPage /></BrowserRouter>)
    expect(screen.getByRole('heading', { name: 'Sign In' })).toBeTruthy()
    expect(screen.getByText('Enter your registered credentials to access your dashboard.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy()
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Recruiter|Admin/i })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Admin setup' })).toBeNull()
  })

  it('navigates to the company dashboard when the server returns the COMPANY role', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        access_token: 'company-access-token',
        refresh_token: 'company-refresh-token',
        role: 'COMPANY',
        user_id: 12,
        name: 'Example Company',
      },
    } as never)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/company/jobs" element={<CurrentPath />} />
          <Route path="/opportunities" element={<CurrentPath />} />
          <Route path="/admin" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'company@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'valid-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(screen.getByText('/company/jobs')).toBeTruthy())
    expect(post).toHaveBeenCalledWith('/auth/login', {
      email: 'company@example.com',
      password: 'valid-password',
    })
    expect(useAuthStore.getState().session?.role).toBe('COMPANY')
  })

  it('opens the saved internships tab from Saved Jobs and omits Placement Hub', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'student-access-token',
      refreshToken: 'student-refresh-token',
      userId: 21,
      role: 'STUDENT',
      email: 'student@example.com',
      name: 'Student',
    })
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/auth/me') return { data: { id: 21, email: 'student@example.com', name: 'Student' } } as never
      if (path === '/notifications' || path === '/internships/saved') return { data: [] } as never
      return { data: { items: [], total: 0, applications: [], counts: {} } } as never
    })

    render(<MemoryRouter initialEntries={['/opportunities']}><App /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    expect(screen.queryByText('Placement Hub')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: /Saved Jobs/ }))

    expect(await screen.findByText('No saved internships')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Saved Roles' }).className).toContain('bg-indigo-600')
  })

  it('opens student analytics from the Analytics menu item', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'student-access-token',
      refreshToken: 'student-refresh-token',
      userId: 21,
      role: 'STUDENT',
      email: 'student@example.com',
      name: 'Student',
    })
    vi.spyOn(api, 'get').mockImplementation(async (path) => {
      if (path === '/auth/me') return { data: { id: 21, email: 'student@example.com', name: 'Student' } } as never
      if (path === '/notifications' || path === '/internships/saved' || path === '/interviews/my') return { data: [] } as never
      if (path === '/analytics/overview') {
        return {
          data: {
            funnel: { applied: 0, screened: 0, interviews: 0, offers: 0 },
            domains: [],
          },
        } as never
      }
      return { data: { applications: [], counts: {} } } as never
    })

    render(<MemoryRouter initialEntries={['/opportunities']}><App /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    fireEvent.click(screen.getByRole('link', { name: 'Analytics' }))

    expect(await screen.findByRole('heading', { name: 'My Analytics' })).toBeTruthy()
    expect(await screen.findByText('Your application journey starts here')).toBeTruthy()
  })
})
