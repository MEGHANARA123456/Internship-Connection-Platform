import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { api } from '../../api/client'
import { VerifyEmailPage } from '../AuthPages'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  downloadAuthenticatedFile: vi.fn(),
}))

function renderVerify(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify" element={<VerifyEmailPage />} />
        <Route path="/verify/:token" element={<VerifyEmailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('email verification resend', () => {
  it('extracts a pasted verification link and resends with a cooldown', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { message: 'Email verified' } } as never)
    vi.mocked(api.post).mockResolvedValue({ data: { message: 'generic' } } as never)
    const view = renderVerify('/verify?email=person%40example.com')

    fireEvent.change(screen.getByLabelText('Verification token'), {
      target: { value: 'https://example.test/verify/pasted-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify account' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/verify/pasted-token'))

    view.unmount()
    renderVerify('/verify?email=person%40example.com')
    fireEvent.click(screen.getByRole('button', { name: /Resend verification email/ }))
    expect(screen.getByLabelText('Email address')).toHaveValue('person@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }))
    expect(await screen.findByRole('status')).toHaveTextContent('The new link is valid for 24 hours')
    expect(api.post).toHaveBeenCalledWith('/auth/resend-verification', { email: 'person@example.com' })
    expect(screen.getByRole('button', { name: 'Resend email in 60s' })).toBeDisabled()
  })

  it('offers resend for expired links and displays the server cooldown message', async () => {
    vi.mocked(api.get).mockRejectedValue({ response: { data: { detail: 'token_expired' } } })
    vi.mocked(api.post).mockRejectedValue({
      response: { status: 429, headers: { 'retry-after': '31' } },
    })
    renderVerify('/verify/expired-token')
    await screen.findByText('This verification link has expired.')
    fireEvent.click(screen.getByRole('button', { name: 'Send a new verification email' }))
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'person@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resend email' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait before requesting another verification email.')
    expect(screen.getByRole('button', { name: 'Resend email in 31s' })).toBeDisabled()
  })
})
