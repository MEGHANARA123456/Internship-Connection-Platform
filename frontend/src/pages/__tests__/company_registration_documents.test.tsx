import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { CompanyRegisterPage } from '../AuthPages'
import { useAuthStore } from '../../store/auth'

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

describe('Company registration document wizard', () => {
  it('requires and submits business registration after company details', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
      if (url === '/auth/register/company') return { data: { id: 44, email: 'recruiter@example.com' } } as never
      if (url === '/auth/login') return {
        data: { access_token: 'access', refresh_token: 'refresh', role: 'COMPANY', user_id: 44, is_first_login: true },
      } as never
      if (url === '/profiles/company/documents') return { data: { id: 801, document_type: 'BUSINESS_REGISTRATION' } } as never
      throw new Error(`Unexpected POST ${url}`)
    })

    render(<MemoryRouter><CompanyRegisterPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Example Corp' } })
    fireEvent.change(screen.getByLabelText('Corporate Work Email'), { target: { value: 'recruiter@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } })
    fireEvent.change(screen.getByLabelText('Industry'), { target: { value: 'Technology' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to verification documents' }))

    expect(await screen.findByText('Business registration')).toBeInTheDocument()
    expect(screen.getByText('GST or PAN document (optional)')).toBeInTheDocument()
    expect(screen.getByText('Authorization letter (optional)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit verification' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Business registration document is required')
    expect(post).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Upload Business registration'), {
      target: { files: [new File(['png'], 'fake.pdf', { type: 'image/png' })] },
    })
    expect(await screen.findByText('Choose a PDF, JPG, or PNG document.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Upload Business registration'), {
      target: { files: [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'oversized.pdf', { type: 'application/pdf' })] },
    })
    expect(await screen.findByText('File must be 5 MB or smaller.')).toBeInTheDocument()

    const registrationFile = new File(['business registration'], 'registration.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload Business registration'), {
      target: { files: [registrationFile] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit verification' }))

    expect(await screen.findByRole('heading', { name: 'Submitted for admin verification' })).toBeInTheDocument()
    expect(post).toHaveBeenNthCalledWith(1, '/auth/register/company', expect.objectContaining({
      email: 'recruiter@example.com',
      company_name: 'Example Corp',
    }))
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/profiles/company/documents',
      expect.any(FormData),
      expect.objectContaining({ onUploadProgress: expect.any(Function) }),
    ))
    expect(post).toHaveBeenNthCalledWith(2, '/auth/login', {
      email: 'recruiter@example.com',
      password: 'valid-password',
    })
  })

  it('keeps the created account and selected files when login fails and retries without registering again', async () => {
    let loginAttempts = 0
    const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
      if (url === '/auth/register/company') return { data: { id: 45, email: 'retry@example.com' } } as never
      if (url === '/auth/login') {
        loginAttempts += 1
        if (loginAttempts === 1) throw { response: { data: { detail: 'Email verification required.' } } }
        return { data: { access_token: 'access', refresh_token: 'refresh', role: 'COMPANY', user_id: 45 } } as never
      }
      if (url === '/profiles/company/documents') return { data: { id: 802, document_type: 'BUSINESS_REGISTRATION' } } as never
      throw new Error(`Unexpected POST ${url}`)
    })
    render(<MemoryRouter><CompanyRegisterPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'Retry Corp' } })
    fireEvent.change(screen.getByLabelText('Corporate Work Email'), { target: { value: 'retry@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'valid-password' } })
    fireEvent.change(screen.getByLabelText('Industry'), { target: { value: 'Technology' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to verification documents' }))
    await screen.findByText('Business registration')
    fireEvent.change(screen.getByLabelText('Upload Business registration'), {
      target: { files: [new File(['registration'], 'registration.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit verification' }))

    expect(await screen.findByText('Your company account is already created. Sign in and retry uploading the selected files; do not register again.')).toBeInTheDocument()
    expect(screen.getByText('registration.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry sign-in and upload' }))
    expect(await screen.findByRole('heading', { name: 'Submitted for admin verification' })).toBeInTheDocument()
    expect(post.mock.calls.filter(([url]) => url === '/auth/register/company')).toHaveLength(1)
  })
})
