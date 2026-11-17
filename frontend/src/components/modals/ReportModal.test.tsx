import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { ReportModal } from './ReportModal'

vi.mock('../../api/client', () => ({
  api: { post: vi.fn() },
}))

afterEach(() => {
  vi.resetAllMocks()
})

describe('ReportModal focus', () => {
  it('keeps focus in the report reason while typing a full sentence', async () => {
    const user = userEvent.setup()
    render(
      <ReportModal
        isOpen
        onClose={vi.fn()}
        internshipId={17}
        targetTitle="Frontend Intern"
      />,
    )
    const reason = await screen.findByRole('textbox', { name: 'Reason for report' })
    const sentence = 'The listing included inaccurate details about the internship.'

    expect(reason).toHaveFocus()
    await user.type(reason, sentence)

    expect(reason).toHaveValue(sentence)
    expect(document.activeElement).toBe(reason)
    expect(api.post).not.toHaveBeenCalled()
  })
})
