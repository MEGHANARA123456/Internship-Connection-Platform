import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { ApplyModal, type EligibilityResponse } from './ApplyModal'

const allowedEligibility: EligibilityResponse = {
  can_apply: true,
  blockers: [],
  warnings: [],
  match_score: 84,
  matched_skills: ['TypeScript'],
  missing_skills: ['React'],
  resume: { filename: 'resume.pdf', uploaded_at: '2026-10-01T12:00:00Z' },
}

function renderModal(onApplied = vi.fn(), eligibility = allowedEligibility) {
  vi.spyOn(api, 'get').mockResolvedValue({ data: eligibility } as never)
  return {
    onApplied,
    ...render(
      <MemoryRouter>
        <ApplyModal
          isOpen
          onClose={vi.fn()}
          internshipId={17}
          internshipTitle="Frontend Intern"
          companyName="Example Co"
          location="Remote"
          stipend={1200}
          deadline="2026-12-01"
          onApplied={onApplied}
        />
      </MemoryRouter>,
    ),
  }
}

async function goToConfirm() {
  await screen.findByRole('heading', { name: 'Review internship' })
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
  expect(await screen.findByRole('heading', { name: 'Resume & cover note' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
  expect(await screen.findByRole('heading', { name: 'Confirm your application' })).toBeInTheDocument()
}

describe('ApplyModal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows eligibility blockers with action links and disables submit', async () => {
    renderModal(vi.fn(), {
      can_apply: false,
      blockers: [
        { code: 'PROFILE_INCOMPLETE', message: 'Complete your profile. Missing: skills.', action_url: '/profile/student' },
        { code: 'EMAIL_NOT_VERIFIED', message: 'Verify your email before applying.', action_url: '/verify' },
      ],
      warnings: [],
      match_score: 35,
      matched_skills: [],
      missing_skills: ['Python'],
      resume: null,
    })

    expect(await screen.findByText('Complete your profile. Missing: skills.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Complete profile' })).toHaveAttribute('href', '/profile/student')
    expect(screen.getByRole('link', { name: 'Verify email' })).toHaveAttribute('href', '/verify')
    expect(screen.getByRole('button', { name: 'Submit Application' })).toBeDisabled()
  })

  it('shows low-match advice without optimistic language', async () => {
    renderModal(vi.fn(), { ...allowedEligibility, match_score: 35, matched_skills: [], missing_skills: ['Python'] })

    expect(await screen.findByText('Low match, you are missing: Python. You can still apply.')).toBeInTheDocument()
    expect(screen.queryByText(/exceptionally well-aligned/i)).toBeNull()
  })

  it('ignores double clicks and shows the successful application state', async () => {
    renderModal()
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { id: 42 } } as never)

    await goToConfirm()
    const submit = screen.getByRole('button', { name: 'Submit Application' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    await screen.findByRole('heading', { name: 'Application submitted' })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/applications/internships/17', { cover_note: null })
    expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute('href', '/applications?id=42')
    expect(screen.getByRole('button', { name: 'Keep exploring' })).toBeInTheDocument()
  })

  it('shows the backend profile blocker and action for PROFILE_INCOMPLETE', async () => {
    renderModal()
    vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: 'Complete your profile before applying.',
          code: 'PROFILE_INCOMPLETE',
          blockers: [{ code: 'PROFILE_INCOMPLETE', message: 'Complete your profile before applying.', action_url: '/profile/student' }],
        },
      },
    })
    await goToConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Submit Application' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Complete your profile before applying.')
    expect(screen.getByRole('link', { name: 'Complete profile' })).toHaveAttribute('href', '/profile/student')
  })

  it('shows current status and the application link for ALREADY_APPLIED', async () => {
    renderModal()
    vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 409,
        data: {
          detail: 'You already applied to this internship (status: Under Review).',
          code: 'ALREADY_APPLIED',
          blockers: [{ code: 'ALREADY_APPLIED', message: 'You already applied to this internship (status: Under Review).', action_url: '/applications?id=42', application_id: 42, status: 'UNDER_REVIEW' }],
        },
      },
    })
    await goToConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Submit Application' }))
    expect(await screen.findByText('You already applied to this internship (status: Under Review).')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Current status: Under Review')
    expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute('href', '/applications?id=42')
  })

  it('offers a retry for the generic server error without blaming the profile', async () => {
    renderModal()
    vi.spyOn(api, 'post').mockRejectedValue({
      response: { status: 500, data: { detail: 'Could not submit your application. Please try again.' } },
    })
    await goToConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Submit Application' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not submit your application. Please try again.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText(/verify your profile/i)).toBeNull()
  })

  it('shows the selected resume and the optional cover note counter', async () => {
    renderModal()
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }))
    expect(await screen.findByText('resume.pdf')).toBeInTheDocument()
    expect(screen.getByText('0/1000')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Cover note (optional)'), { target: { value: 'A note' } })
    await waitFor(() => expect(screen.getByText('6/1000')).toBeInTheDocument())
  })
})
