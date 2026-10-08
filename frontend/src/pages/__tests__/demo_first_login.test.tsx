import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { LoginPage } from '../AuthPages'
import { useAuthStore } from '../../store/auth'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  useAuthStore.getState().logout()
})

async function signIn(role: string, isFirstLogin: boolean) {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_MAILPIT_URL', 'http://localhost:8025')
  vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      role,
      user_id: 5,
      is_first_login: isFirstLogin,
    },
  } as never)
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
  await waitFor(() => expect(api.post).toHaveBeenCalled())
}

describe('demo mail first-login prompt', () => {
  it('shows only for a company first login when demo mode is enabled', async () => {
    await signIn('COMPANY', true)
    expect(await screen.findByText('Your emails are delivered to the demo mail inbox')).toBeInTheDocument()
    expect(screen.getByText('After this, find all your emails under Notifications & Mailbox.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open mail inbox' })).toHaveAttribute('href', 'http://localhost:8025')
  })

  it('does not show for other roles or a returning company', async () => {
    await signIn('STUDENT', true)
    expect(screen.queryByText('Your emails are delivered to the demo mail inbox')).not.toBeInTheDocument()
    cleanup()
    vi.restoreAllMocks()
    useAuthStore.getState().logout()

    await signIn('COMPANY', false)
    expect(screen.queryByText('Your emails are delivered to the demo mail inbox')).not.toBeInTheDocument()
  })
})
