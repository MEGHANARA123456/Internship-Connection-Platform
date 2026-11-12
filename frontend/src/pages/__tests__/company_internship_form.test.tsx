import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { CompanyPortalShell, JobFormPage } from '../CompanyPages'

afterEach(() => {
  vi.restoreAllMocks()
})

function renderJobForm() {
  return render(<MemoryRouter><JobFormPage /></MemoryRouter>)
}

function fillRequiredFields(industry = 'Information Technology') {
  fireEvent.change(screen.getByLabelText(/^Job Title/), { target: { value: 'Python Developer' } })
  fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: 'Bangalore, Karnataka, India' } })
  fireEvent.change(screen.getByLabelText(/^Industry/), { target: { value: industry } })
  fireEvent.change(screen.getByLabelText(/^Application Deadline/), {
    target: { value: '2027-01-31' },
  })
  fireEvent.change(screen.getByLabelText(/^Full Description & Requirements/), {
    target: { value: 'Build and maintain Python applications.' },
  })
}

describe('internship form submission', () => {
  it('marks schema-required fields and leaves optional skills unmarked', () => {
    renderJobForm()

    const requiredNote = screen.getByText('Required fields')
    expect(requiredNote.parentElement?.querySelector('[aria-hidden="true"]')).toHaveTextContent('*')
    for (const label of [
      'Job Title',
      'Location',
      'Industry',
      'Work Mode',
      'Duration (Months)',
      'Monthly stipend (₹)',
      'Application Deadline',
      'Full Description & Requirements',
    ]) {
      expect(screen.getByText(label, { selector: 'label, p' })).toBeInTheDocument()
      expect(screen.getByText(label, { selector: 'label, p' }).parentElement?.querySelector('[aria-hidden="true"]')).toHaveTextContent('*')
    }

    for (const label of ['Job Title', 'Location', 'Industry', 'Duration (Months)', 'Monthly stipend (₹)', 'Application Deadline', 'Full Description & Requirements']) {
      expect(screen.getByLabelText(label, { exact: false })).toHaveAttribute('aria-required', 'true')
    }
    const stipendInput = screen.getByLabelText(/Monthly stipend/)
    expect(stipendInput).toHaveAttribute('max', '1000000')
    expect(screen.getByText('₹', { exact: true })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Work Mode, required' })).toBeInTheDocument()
    const optionalSkills = screen.getByLabelText('Required Skills / Keywords')
    expect(optionalSkills.parentElement?.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('accepts realistic INR stipends and rejects amounts above the monthly limit', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 8 } } as never)
    const { unmount } = renderJobForm()
    fillRequiredFields()
    fireEvent.change(screen.getByLabelText(/Monthly stipend/), { target: { value: '25000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Internship (Draft)' }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ stipend: 25000 }))

    unmount()
    post.mockClear()
    const { container } = renderJobForm()
    fillRequiredFields()
    fireEvent.change(screen.getByLabelText(/Monthly stipend/), { target: { value: '1000001' } })
    fireEvent.submit(container.querySelector('form')!)
    expect(await screen.findByText('Stipend must be 1,000,000 or less')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('renders company content without a sidebar navigation column', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/company']}>
        <Routes>
          <Route element={<CompanyPortalShell />}>
            <Route path="/company" element={<p>Company content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Company content')).toBeInTheDocument()
    expect(screen.queryByText('Company portal')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Company portal navigation' })).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('max-w-7xl')
  })

  it('keeps the existing empty-field validation messages', async () => {
    const post = vi.spyOn(api, 'post')
    renderJobForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create Internship (Draft)' }))

    expect(await screen.findByText('Title must be at least 3 characters')).toBeInTheDocument()
    expect(screen.getByText('Location is required (e.g. Remote or San Francisco, CA)')).toBeInTheDocument()
    expect(screen.getByText('Industry is required')).toBeInTheDocument()
    expect(screen.getByText('Application deadline is required')).toBeInTheDocument()
    expect(screen.getByText('Provide a detailed description of duties and qualifications')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

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
    expect(screen.getByLabelText(/^Industry/)).toHaveValue('Information Technology / Software Development')
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
