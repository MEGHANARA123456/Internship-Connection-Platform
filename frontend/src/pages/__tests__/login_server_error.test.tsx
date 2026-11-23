import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { LoginPage } from '../AuthPages'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('login server errors', () => {
  it('shows a retryable connection message when the server cannot be reached', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValue({
      isAxiosError: true,
      code: 'ERR_NETWORK',
      message: 'Network Error',
    })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'person@example.test' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'test-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText(
      "Can't reach the server. Please check your connection or try again shortly.",
    )).toBeInTheDocument()
    expect(screen.queryByText(/check your credentials/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  })

  it('shows a generic message without exposing the server response body', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 500,
        data: { detail: 'UndefinedColumnError: users.first_login_at does not exist' },
      },
    })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'person@example.test' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'test-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Server error, please try again')).toBeInTheDocument()
    expect(screen.queryByText(/UndefinedColumnError|first_login_at/)).not.toBeInTheDocument()
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/auth/login',
      expect.objectContaining({ email: 'person@example.test' }),
    ))
  })
})
