import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { CompanyProfilePage } from '../CompanyPages'
import { useAuthStore } from '../../store/auth'

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().logout()
})

describe('Company profile verification documents', () => {
  it('loads the document collection, displays verification notes, supports add-more and delete', async () => {
    const document = {
      id: 71,
      document_type: 'BUSINESS_REGISTRATION',
      original_filename: 'registration.pdf',
      verification_status: 'REJECTED',
      created_at: '2026-09-20T12:00:00Z',
    }
    const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/profiles/company') return { data: {
        company_name: 'Example Corp',
        industry: 'Technology',
        verification_status: 'REJECTED',
        verification_note: 'Upload a clearer registration scan.',
      } } as never
      if (url === '/profiles/company/documents') return { data: [document] } as never
      return { data: [] } as never
    })
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { id: 72, document_type: 'GST_OR_PAN', original_filename: 'gst.pdf', verification_status: 'PENDING' },
    } as never)
    const remove = vi.spyOn(api, 'delete').mockResolvedValue({ data: undefined } as never)

    render(<MemoryRouter><CompanyProfilePage /></MemoryRouter>)
    expect(await screen.findByText('registration.pdf')).toBeInTheDocument()
    expect(screen.getByText('Upload a clearer registration scan.')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/profiles/company/documents')

    fireEvent.change(screen.getByLabelText('Document type to add'), { target: { value: 'GST_OR_PAN' } })
    fireEvent.change(screen.getByLabelText('Add verification document'), {
      target: { files: [new File(['gst'], 'gst.pdf', { type: 'application/pdf' })] },
    })
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/profiles/company/documents',
      expect.any(FormData),
      expect.objectContaining({ onUploadProgress: expect.any(Function) }),
    ))
    expect(await screen.findByText('gst.pdf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete registration.pdf' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('/profiles/company/documents/71'))
    expect(screen.queryByText('registration.pdf')).not.toBeInTheDocument()
  })
})
