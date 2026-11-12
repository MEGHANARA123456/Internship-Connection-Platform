import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../../api/client'
import { ScheduleInterviewModal } from './ScheduleInterviewModal'

vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}))

afterEach(() => {
  vi.resetAllMocks()
})

describe('schedule interview role and candidate selection', () => {
  it('shows neutral, loading, empty, and candidate states as roles change', async () => {
    let finishEmptyRoleLoad: ((value: { data: unknown[] }) => void) | undefined
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/internships/mine') {
        return Promise.resolve({
          data: [
            { id: 11, title: 'Frontend Intern', status: 'PUBLISHED' },
            { id: 12, title: 'Backend Intern', status: 'PUBLISHED' },
            { id: 13, title: 'Draft Intern', status: 'DRAFT' },
          ],
        }) as never
      }
      if (url === '/applications/internships/11') {
        return Promise.resolve({
          data: [{
            id: 101,
            student_id: 501,
            student_name: 'Alex Student',
            student_university: 'Example University',
            status: 'APPLIED',
          }],
        }) as never
      }
      if (url === '/applications/internships/12') {
        return new Promise((resolve) => {
          finishEmptyRoleLoad = resolve
        }) as never
      }
      return Promise.resolve({ data: [] }) as never
    })

    render(
      <ScheduleInterviewModal
        isOpen
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    )

    expect(await screen.findByText('Select an internship role to see its candidates.')).toBeInTheDocument()
    expect(screen.queryByText('No candidates have applied to this role yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Select Candidate' })).not.toBeInTheDocument()

    const rolePicker = screen.getByRole('combobox', { name: 'Internship Role' })
    fireEvent.click(rolePicker)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    fireEvent.click(screen.getByRole('option', { name: 'Frontend Intern' }))

    const candidatePicker = await screen.findByRole('combobox', { name: 'Select Candidate' })
    expect(api.get).toHaveBeenCalledWith('/applications/internships/11')
    fireEvent.click(candidatePicker)
    fireEvent.click(screen.getByRole('option', { name: /Alex Student/ }))
    const submit = screen.getByRole('button', { name: 'Confirm & Schedule' })
    expect(submit).toBeEnabled()

    fireEvent.click(rolePicker)
    fireEvent.click(screen.getByRole('option', { name: 'Backend Intern' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Loading candidates...')
    expect(screen.queryByText('No candidates have applied to this role yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Select Candidate' })).not.toBeInTheDocument()
    expect(submit).toBeDisabled()

    await act(async () => {
      finishEmptyRoleLoad?.({ data: [] })
    })
    expect(await screen.findByText('No candidates have applied to this role yet.')).toBeInTheDocument()

    fireEvent.click(rolePicker)
    fireEvent.click(screen.getByRole('option', { name: 'Frontend Intern' }))
    await waitFor(() => {
      expect(screen.queryByText('No candidates have applied to this role yet.')).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('combobox', { name: 'Select Candidate' })).toBeInTheDocument()
    expect(submit).toBeDisabled()

    expect(screen.getByText('Quick Recommended Slots')).toBeInTheDocument()
    expect(screen.getByLabelText('Date & Time')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Interview Format' })).toBeInTheDocument()
  })

  it('selects a role with the keyboard and loads its applicants', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/internships/mine') {
        return Promise.resolve({
          data: [
            { id: 21, title: 'Product Intern', status: 'PUBLISHED' },
            { id: 22, title: 'Design Intern', status: 'PUBLISHED' },
          ],
        }) as never
      }
      if (url === '/applications/internships/21') {
        return Promise.resolve({
          data: [{ id: 201, student_id: 601, student_name: 'Jamie Applicant', status: 'APPLIED' }],
        }) as never
      }
      return Promise.resolve({ data: [] }) as never
    })

    render(
      <ScheduleInterviewModal
        isOpen
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    )

    const rolePicker = await screen.findByRole('combobox', { name: 'Internship Role' })
    rolePicker.focus()
    fireEvent.keyDown(rolePicker, { key: 'ArrowDown' })

    const firstRole = await screen.findByRole('option', { name: 'Product Intern' })
    await waitFor(() => expect(firstRole).toHaveFocus())
    fireEvent.keyDown(firstRole, { key: 'Enter' })
    fireEvent.click(firstRole)

    const candidatePicker = await screen.findByRole('combobox', { name: 'Select Candidate' })
    expect(api.get).toHaveBeenCalledWith('/applications/internships/21')
    fireEvent.click(candidatePicker)
    expect(await screen.findByRole('option', { name: /Jamie Applicant/ })).toBeInTheDocument()
  })

  it('shows a loading role dropdown until the owned roles load', async () => {
    let finishRoleLoad: ((value: { data: unknown[] }) => void) | undefined
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/internships/mine') {
        return new Promise((resolve) => {
          finishRoleLoad = resolve
        }) as never
      }
      return Promise.resolve({ data: [] }) as never
    })

    render(
      <ScheduleInterviewModal
        isOpen
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    )

    const rolePicker = screen.getByRole('combobox', { name: 'Internship Role' })
    expect(rolePicker).toBeDisabled()
    expect(rolePicker).toHaveTextContent('Loading roles...')
    expect(screen.queryByText('You have no open roles yet.')).not.toBeInTheDocument()

    await act(async () => {
      finishRoleLoad?.({ data: [{ id: 31, title: 'Data Intern', status: 'PUBLISHED' }] })
    })
    const loadedRolePicker = await screen.findByRole('combobox', { name: 'Internship Role' })
    fireEvent.click(loadedRolePicker)
    expect(await screen.findByRole('option', { name: 'Data Intern' })).toBeInTheDocument()
  })

  it('shows a retry action when company roles fail to load', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({
        data: [{ id: 41, title: 'QA Intern', status: 'PUBLISHED' }],
      } as never)

    render(
      <ScheduleInterviewModal
        isOpen
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load your open roles.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('No candidates have applied to this role yet.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const rolePicker = await screen.findByRole('combobox', { name: 'Internship Role' })
    expect(api.get).toHaveBeenCalledTimes(2)
    fireEvent.click(rolePicker)
    expect(await screen.findByRole('option', { name: 'QA Intern' })).toBeInTheDocument()
  })

  it('shows a post-internship link when the company has no open roles', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [
      { id: 51, title: 'Draft Role', status: 'DRAFT' },
      { id: 52, title: 'Pending Role', status: 'PENDING_APPROVAL' },
      { id: 53, title: 'Closed Role', status: 'CLOSED' },
    ] } as never)

    render(
      <MemoryRouter>
        <ScheduleInterviewModal
          isOpen
          onClose={vi.fn()}
          onScheduled={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText((_, element) => (
      element?.tagName === 'P' && Boolean(element.textContent?.includes('You have no open roles yet.'))
    ))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Post Internship' })).toHaveAttribute('href', '/company/internships/new')
    expect(screen.queryByText('Select an internship role to see its candidates.')).not.toBeInTheDocument()
    expect(screen.queryByText('No candidates have applied to this role yet.')).not.toBeInTheDocument()
  })
})
