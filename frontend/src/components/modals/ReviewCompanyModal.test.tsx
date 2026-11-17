import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { ReviewCompanyModal } from './ReviewCompanyModal'

vi.mock('../../api/client', () => ({
  api: { post: vi.fn() },
}))

afterEach(() => {
  vi.resetAllMocks()
})

describe('ReviewCompanyModal focus', () => {
  it('keeps focus in the review textarea while typing a full sentence', async () => {
    const user = userEvent.setup()
    render(
      <ReviewCompanyModal
        isOpen
        onClose={vi.fn()}
        companyId={12}
        internshipId={17}
        companyName="Example Company"
      />,
    )
    const review = screen.getByRole('textbox', { name: 'Detailed Review & Experience' })
    const sentence = 'The team provided useful mentorship and meaningful project work.'

    expect(review).toHaveFocus()
    await user.type(review, sentence)

    expect(review).toHaveValue(sentence)
    expect(document.activeElement).toBe(review)
    expect(api.post).not.toHaveBeenCalled()
  })
})
