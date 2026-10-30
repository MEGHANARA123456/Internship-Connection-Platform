import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { JobFormPage } from '../CompanyPages'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderJobForm() {
  return render(<MemoryRouter><JobFormPage /></MemoryRouter>)
}

function fillRequiredFields(industry = 'Information Technology') {
  fireEvent.change(screen.getByLabelText('Job Title'), { target: { value: 'Python Developer' } })
  fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Bangalore, Karnataka, India' } })
  fireEvent.change(screen.getByLabelText('Industry'), { target: { value: industry } })
  fireEvent.change(screen.getByLabelText('Application Deadline'), {
    target: { value: '2027-01-31' },
  })
  fireEvent.change(screen.getByLabelText('Full Description & Requirements'), {
    target: { value: 'Build and maintain Python applications.' },
  })
}

describe('internship form submission', () => {
  it('rejects an industry over 255 characters before calling the API', async () => {
    const post = vi.spyOn(api, 'post')
    renderJobForm()
    fillRequiredFields('I'.repeat(256))
    fireEvent.click(screen.getByRole('button', { name: 'Create Internship (Draft)' }))

    expect(await screen.findByText('Industry must be 255 characters or fewer')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('shows a 422 field error and keeps the entered values', async () => {
    const scrollIntoView = vi.fn()
    const previousScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    const post = vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [{ loc: ['body', 'industry'], msg: 'Industry is not accepted' }],
        },
      },
    })
    renderJobForm()
    fillRequiredFields('Information Technology / Software Development')
    fireEvent.click(screen.getByRole('button', { name: 'Create Internship (Draft)' }))

    expect(await screen.findByText('Please fix the highlighted fields.')).toBeInTheDocument()
    expect(await screen.findByText('Industry is not accepted')).toBeInTheDocument()
    expect(screen.getByLabelText('Industry')).toHaveValue('Information Technology / Software Development')
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    if (previousScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previousScrollIntoView)
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('shows a string conflict detail as-is', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 409,
        data: { detail: 'You already have an active internship with this title and location' },
      },
    })
    renderJobForm()
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Create Internship (Draft)' }))

    expect(await screen.findByText(
      'You already have an active internship with this title and location',
    )).toBeInTheDocument()
  })
})
