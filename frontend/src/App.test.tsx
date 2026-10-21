import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { LoginPage } from './pages/AuthPages'
import { api } from './api/client'
import { useAuthStore } from './store/auth'

function CurrentPath() {
  return <div>{useLocation().pathname}</div>
}

function CurrentLocation() {
  const location = useLocation()
  return <div>{`${location.pathname}${location.search}`}</div>
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
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
    expect(screen.getByLabelText('Keep me signed in on this device')).not.toBeChecked()
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
    expect(sessionStorage.getItem('session')).not.toBeNull()
    expect(localStorage.getItem('session')).toBeNull()
  })

  it('persists the login session only when the device checkbox is selected', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        access_token: 'student-access-token',
        refresh_token: 'student-refresh-token',
        role: 'STUDENT',
        user_id: 13,
      },
    } as never)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/opportunities" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'student@example.com' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'valid-password' },
    })
    fireEvent.click(screen.getByLabelText('Keep me signed in on this device'))
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(screen.getByText('/opportunities')).toBeTruthy())
    expect(localStorage.getItem('session')).not.toBeNull()
    expect(sessionStorage.getItem('session')).toBeNull()
  })

  it('shows the cross-tab session-change banner for persistent sessions', async () => {
    vi.useFakeTimers()
    useAuthStore.getState().setSession({
      accessToken: 'student-access-token',
      refreshToken: 'student-refresh-token',
      userId: 301,
      role: 'STUDENT',
      email: 'student@example.com',
    }, 'local')
    vi.spyOn(api, 'get').mockResolvedValue({ data: {} } as never)
    render(<MemoryRouter><App /></MemoryRouter>)

    act(() => {
      fireEvent(window, new StorageEvent('storage', {
        key: 'session',
        newValue: JSON.stringify({
          accessToken: 'company-access-token',
          refreshToken: 'company-refresh-token',
          userId: 302,
          role: 'COMPANY',
          email: 'company@example.com',
        }),
        storageArea: localStorage,
      }))
    })

    const notice = screen.getAllByRole('alert').find((element) =>
      element.textContent?.includes('Your session changed in another tab'),
    )
    expect(notice).toBeDefined()
  })

  it('opens the saved internships destination from the Internships menu without a Placement Hub entry', async () => {
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

    expect(screen.queryByRole('menuitem', { name: /Placement Hub/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    fireEvent.click(screen.getByRole('button', { name: /Internships/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Saved internships/ }))

    expect(await screen.findByText('No saved internships')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Saved Roles' }).className).toContain('bg-indigo-600')
  })

  it('renders a real not-found page for an unknown college dashboard route', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'student-access-token',
      refreshToken: 'student-refresh-token',
      userId: 21,
      role: 'STUDENT',
      email: 'student@example.com',
      name: 'Student',
    })
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never)
    render(
      <MemoryRouter initialEntries={['/college/dashboard']}>
        <App />
        <CurrentPath />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(screen.getByText('/college/dashboard')).toBeTruthy()
  })

  it('renders a real not-found page for an unknown endorsement link', async () => {
    render(
      <MemoryRouter initialEntries={['/endorse/example-token']}>
        <App />
        <CurrentPath />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(screen.getByText('/endorse/example-token')).toBeTruthy()
  })

  it('retains the full interview URL when a logged-out visitor is sent to sign in', async () => {
    render(
      <MemoryRouter initialEntries={['/interviews?tab=upcoming&highlight=17']}>
        <App />
        <CurrentLocation />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Sign In' })).toBeTruthy()
    expect(screen.getByText('/login?next=%2Finterviews%3Ftab%3Dupcoming%26highlight%3D17')).toBeTruthy()
  })

  it('returns a student to the requested interview page after login', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never)
    vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        access_token: 'student-access-token',
        refresh_token: 'student-refresh-token',
        role: 'STUDENT',
        user_id: 72,
      },
    } as never)
    render(
      <MemoryRouter initialEntries={['/login?next=%2Finterviews%3Ftab%3Dupcoming%26highlight%3D17']}>
        <App />
        <CurrentLocation />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'student@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByRole('heading', { name: 'Interviews & Meetings' })).toBeTruthy()
    expect(screen.getByText('/interviews?tab=upcoming&highlight=17')).toBeTruthy()
  })

  it('shows a friendly wrong-role screen instead of the landing page for admins', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'admin-access-token',
      refreshToken: 'admin-refresh-token',
      userId: 73,
      role: 'ADMIN',
      email: 'admin@example.com',
    })
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never)
    render(<MemoryRouter initialEntries={['/interviews']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: "This page isn't available for your account" })).toBeTruthy()
    expect(screen.queryByText('Browse Internships')).toBeNull()
  })

  it('renders the shared interviews page for a company account', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'company-access-token',
      refreshToken: 'company-refresh-token',
      userId: 74,
      role: 'COMPANY',
      email: 'company@example.com',
    })
    vi.spyOn(api, 'get').mockResolvedValue({ data: [] } as never)
    render(<MemoryRouter initialEntries={['/interviews?tab=upcoming']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: 'Interviews & Meetings' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Interviews' }).some((link) =>
      link.getAttribute('href') === '/interviews?tab=upcoming',
    )).toBe(true)
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Analytics' }))

    expect(await screen.findByRole('heading', { name: 'My Analytics' })).toBeTruthy()
  })
})
