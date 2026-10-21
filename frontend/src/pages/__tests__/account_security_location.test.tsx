import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { AccountSecurityCard } from '../../components/security/AccountSecurityCard'
import { PrivacySecurityPage } from '../PrivacySecurityPage'
import { useAuthStore } from '../../store/auth'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

afterEach(() => {
  useAuthStore.getState().logout()
  vi.clearAllMocks()
})

describe('account security location', () => {
  it.each(['STUDENT', 'COMPANY', 'ADMIN'] as const)('shows account security for %s users', async (role) => {
    useAuthStore.getState().setSession({
      accessToken: 'token', refreshToken: 'refresh', userId: 1, email: 'user@example.com', role,
    })
    vi.mocked(api.get).mockResolvedValue({ data: { mfa_enabled: false } } as never)
    render(<BrowserRouter><PrivacySecurityPage /></BrowserRouter>)
    expect(await screen.findByRole('heading', { name: 'Account security' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable Email 2FA' })).toBeInTheDocument()
  })

  it('does not show the account security card to visitors', () => {
    render(<BrowserRouter><PrivacySecurityPage /></BrowserRouter>)
    expect(screen.queryByRole('heading', { name: 'Account security' })).not.toBeInTheDocument()
    expect(screen.getByText(/Privacy & Data Security Center/)).toBeInTheDocument()
  })

  it('preserves password and MFA API actions', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { mfa_enabled: false } } as never)
    vi.mocked(api.post).mockResolvedValue({ data: { message: 'ok' } } as never)
    render(<AccountSecurityCard userEmail="user@example.com" role="STUDENT" />)
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save New Password' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/change-password', {
      current_password: 'old-password', new_password: 'new-password',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Enable Email 2FA' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/mfa/setup-request'))
  })
})
