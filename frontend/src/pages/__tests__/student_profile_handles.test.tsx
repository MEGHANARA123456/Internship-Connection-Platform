import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { StudentProfilePage } from '../StudentPages'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  downloadAuthenticatedFile: vi.fn(),
  getFullMediaUrl: (url: string | null) => url,
}))

function renderStudentProfile() {
  return render(<MemoryRouter><StudentProfilePage /></MemoryRouter>)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('student_github_handle', 'https://github.com/Bharadwaj3695/')
  useAuthStore.setState({
    session: { accessToken: 'test', refreshToken: 'test', role: 'STUDENT', userId: 42, email: 'student@example.com' },
  })
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/profiles/student') return { data: { full_name: 'Test Student', skills: '', graduation_year: 2026 } } as never
    if (url === '/profiles/student/resume') return { data: null } as never
    return { data: [] } as never
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('StudentProfilePage GitHub card', () => {
  it('shows a valid verified badge beside the matching profile skill', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/profiles/student') return { data: { full_name: 'Test Student', skills: 'Python, React', graduation_year: 2026 } } as never
      if (url === '/profiles/student/resume') return { data: null } as never
      if (url === '/skills/badges') return {
        data: [{ id: 1, topic: 'python', title: 'Verified Python Specialist', level: 'Silver', score: 95, valid: true }],
      } as never
      return { data: [] } as never
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')))

    renderStudentProfile()

    const profileSkills = await screen.findByLabelText('Profile skills and verified badges')
    expect(profileSkills).toHaveTextContent('Python')
    expect(profileSkills).toHaveTextContent('React')
    expect(profileSkills).toHaveTextContent(/verified/i)
    expect(profileSkills).toHaveTextContent('Silver')
  })

  it('links the successful GitHub profile and caches the response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        login: 'Bharadwaj3695',
        name: 'Bharadwaj',
        avatar_url: 'https://avatars.githubusercontent.com/u/42',
        public_repos: 4,
        followers: 8,
      }),
    }))

    renderStudentProfile()
    const links = await screen.findAllByRole('link', { name: 'Open GitHub profile' })
    expect(localStorage.getItem('student_github_handle')).toBe('Bharadwaj3695')
    expect(links[0]).toHaveAttribute('href', 'https://github.com/Bharadwaj3695')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: '@Bharadwaj3695' })).toHaveAttribute('href', 'https://github.com/Bharadwaj3695')
    await waitFor(() => expect(sessionStorage.getItem('student-github-profile:42:bharadwaj3695')).not.toBeNull())
  })

  it('shows the not-found message, edit action, and profile link for a 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    renderStudentProfile()

    expect(await screen.findByText("GitHub user 'Bharadwaj3695' not found")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit handle' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open GitHub profile' })).toHaveAttribute('href', 'https://github.com/Bharadwaj3695')
  })

  it.each([403, 429])('shows the rate-limit message and profile link for a %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }))
    renderStudentProfile()

    expect(await screen.findByText('GitHub is limiting requests right now. Try again in a few minutes.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open GitHub profile' })).toHaveAttribute('href', 'https://github.com/Bharadwaj3695')
  })

  it('shows the network error and retry action when GitHub cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')))
    renderStudentProfile()

    expect(await screen.findByText("Couldn't reach GitHub")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open GitHub profile' })).toHaveAttribute('href', 'https://github.com/Bharadwaj3695')
  })
})
