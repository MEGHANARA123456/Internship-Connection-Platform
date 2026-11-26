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
      'Cannot reach the server. Please try again.',
    )).toBeInTheDocument()
    expect(screen.queryByText(/check your credentials/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
  })

  it('shows the connectivity message for a 5xx without exposing the response body', async () => {
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

    expect(await screen.findByText('Cannot reach the server. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/UndefinedColumnError|first_login_at/)).not.toBeInTheDocument()
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/auth/login',
      expect.objectContaining({ email: 'person@example.test' }),
    ))
  })

  it('shows the account-not-found message only for the login endpoint user-not-found response', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 404,
        data: { detail: "No account found with email 'person@example.test'. Please check for typos or sign up first." },
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

    expect(await screen.findByText('No account registered with this email. Please sign up first.')).toBeInTheDocument()
  })

  it.each([
    ['unrelated 404', { response: { status: 404, data: { detail: 'Route not found' } } }],
    ['request timeout', { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 1000ms exceeded' }],
  ])('shows the connectivity message for %s', async (_label, error) => {
    vi.spyOn(api, 'post').mockRejectedValue(error)

    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'person@example.test' },
    })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'test-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Cannot reach the server. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/No account registered/)).not.toBeInTheDocument()
    expect(screen.queryByText('Route not found')).not.toBeInTheDocument()
  })
})
