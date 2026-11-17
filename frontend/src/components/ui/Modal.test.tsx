import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal focus management', () => {
  it('focuses the first form field once despite parent renders and restores the opener', async () => {
    const user = userEvent.setup()
    function RerenderingModal() {
      const [isOpen, setIsOpen] = useState(false)
      const [value, setValue] = useState('')
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>Open dialog</button>
          <Modal isOpen={isOpen} title="Edit item" onClose={() => setIsOpen(false)}>
            <textarea aria-label="Description" value={value} onChange={(event) => setValue(event.target.value)} />
          </Modal>
        </>
      )
    }

    render(<RerenderingModal />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(opener)
    const description = screen.getByRole('textbox', { name: 'Description' })

    expect(description).toHaveFocus()
    await user.type(description, 'A complete sentence that keeps the focus in place.')
    expect(description).toHaveValue('A complete sentence that keeps the focus in place.')
    expect(document.activeElement).toBe(description)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('focuses the dialog itself when no form field is available', () => {
    render(<Modal isOpen title="Notice" onClose={vi.fn()}>There are no fields.</Modal>)

    expect(screen.getByRole('dialog')).toHaveFocus()
  })
})
