import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { AdminUsersPage } from '../AdminPages'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  downloadAuthenticatedFile: vi.fn(),
}))

const targetUser = {
  id: 21,
  email: 'student@example.com',
  role: 'STUDENT',
  is_active: true,
  is_verified: true,
  email_verification_required: false,
  mfa_enabled: false,
}

beforeEach(() => {
  useAuthStore.setState({
    session: { accessToken: 'token', refreshToken: 'refresh', role: 'ADMIN', userId: 99 },
  })
  vi.mocked(api.get).mockImplementation(async () => ({ data: [targetUser] } as never))
})

afterEach(() => {
  useAuthStore.getState().logout()
  vi.clearAllMocks()
})

async function openDeleteDialog() {
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>)
  const opener = await screen.findByRole('button', { name: 'Delete user student@example.com' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = await screen.findByRole('dialog', { name: 'Permanently delete user' })
  return { dialog, opener }
}

describe('admin permanent-delete dialog focus', () => {
  it('keeps focus in Reason while typing 30 characters', async () => {
    const user = userEvent.setup()
    await openDeleteDialog()
    const reason = screen.getByRole('textbox', { name: /Reason for deletion/ })

    expect(reason).toHaveFocus()
    expect(screen.getByText('0/500 characters')).toBeInTheDocument()
    await user.type(reason, 'R'.repeat(30))

    expect(reason).toHaveValue('R'.repeat(30))
    expect(screen.getByText('30/500 characters')).toBeInTheDocument()
    expect(document.activeElement).toBe(reason)
    await user.clear(reason)
    await user.paste('Reason pasted successfully.')
    expect(reason).toHaveValue('Reason pasted successfully.')
    expect(document.activeElement).toBe(reason)
  })

  it('keeps focus in confirmation email while typing 30 characters', async () => {
    const user = userEvent.setup()
    await openDeleteDialog()
    const email = screen.getByRole('textbox', { name: 'Type the exact email to confirm' })
    const value = 'admin-confirmation@example.com'

    expect(screen.getByRole('textbox', { name: /Reason for deletion/ })).toHaveFocus()
    await user.type(email, value)

    expect(email).toHaveValue(value)
    expect(document.activeElement).toBe(email)
    await user.clear(email)
    await user.paste(value)
    expect(email).toHaveValue(value)
    expect(document.activeElement).toBe(email)
  })

  it('tabs through Reason, email, Cancel, Delete, and Close, and closes on Escape', async () => {
    const user = userEvent.setup()
    const { dialog, opener } = await openDeleteDialog()
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
    )
    focusable.forEach((element) => {
      Object.defineProperty(element, 'offsetParent', { configurable: true, value: document.body })
    })

    const reason = screen.getByRole('textbox', { name: /Reason for deletion/ })
    const email = screen.getByRole('textbox', { name: 'Type the exact email to confirm' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const remove = screen.getByRole('button', { name: 'Delete permanently' })
    const close = screen.getByRole('button', { name: 'Close dialog' })
    expect(reason).toHaveFocus()
    await user.type(reason, 'Valid deletion reason')
    await user.type(email, targetUser.email)
    reason.focus({ preventScroll: true })
    expect(remove).toBeEnabled()
    const expectedOrder = [email, cancel, remove, close, reason]

    for (const element of expectedOrder) {
      await user.tab()
      expect(document.activeElement).toBe(element)
    }

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })
})
