import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

describe('Modal', () => {
  it('portals the dialog and keeps its header and footer outside the scrollable body', () => {
    const { container } = render(
      <Modal
        isOpen
        onClose={() => undefined}
        title="Tall dialog"
        footer={<button type="button">Save</button>}
      >
        <div style={{ minHeight: '1200px' }}>Tall content</div>
      </Modal>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Tall dialog' })
    const overlay = dialog.parentElement
    const [header, body, footer] = Array.from(dialog.children) as HTMLElement[]

    expect(document.body).toContainElement(dialog)
    expect(container).not.toContainElement(dialog)
    expect(overlay).toHaveClass('fixed', 'inset-0', 'items-center', 'justify-center', 'z-[110]')
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]', 'flex', 'flex-col')
    expect(body).toHaveClass('overflow-y-auto', 'overscroll-contain')
    expect(header).toContainElement(screen.getByRole('heading', { name: 'Tall dialog' }))
    expect(body).toContainElement(screen.getByText('Tall content'))
    expect(footer).toHaveClass('sticky', 'bottom-0')
    expect(footer).toContainElement(screen.getByRole('button', { name: 'Save' }))
  })

  it('restores the previous body overflow after the dialog closes', () => {
    document.body.style.overflow = 'clip'
    const { rerender } = render(
      <Modal isOpen title="Scroll lock" onClose={() => undefined}><p>Body</p></Modal>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Modal isOpen={false} title="Scroll lock" onClose={() => undefined}><p>Body</p></Modal>)
    expect(document.body.style.overflow).toBe('clip')
  })

  it('closes on Escape and returns focus to the opener', () => {
    function FocusHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
          <Modal isOpen={open} onClose={() => setOpen(false)} title="Focus dialog">
            <button type="button">Inside dialog</button>
          </Modal>
        </>
      )
    }

    render(<FocusHarness />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    opener.focus()
    fireEvent.click(opener)

    expect(screen.getByRole('dialog', { name: 'Focus dialog' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Focus dialog' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('traps focus and closes nested dialogs from the top down', () => {
    function NestedHarness() {
      const [parentOpen, setParentOpen] = useState(false)
      const [childOpen, setChildOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setParentOpen(true)}>Open parent</button>
          <Modal isOpen={parentOpen} onClose={() => setParentOpen(false)} title="Parent dialog">
            <button type="button" onClick={() => setChildOpen(true)}>Open child</button>
          </Modal>
          <Modal isOpen={childOpen} onClose={() => setChildOpen(false)} title="Child dialog">
            <button type="button">Child action</button>
          </Modal>
        </>
      )
    }

    render(<NestedHarness />)
    const parentOpener = screen.getByRole('button', { name: 'Open parent' })
    parentOpener.focus()
    fireEvent.click(parentOpener)

    const parentDialog = screen.getByRole('dialog', { name: 'Parent dialog' })
    const parentClose = within(parentDialog).getByRole('button', { name: 'Close dialog' })
    const openChild = screen.getByRole('button', { name: 'Open child' })
    parentClose.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(openChild).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(parentClose).toHaveFocus()
    openChild.focus()
    fireEvent.click(openChild)
    expect(screen.getByRole('dialog', { name: 'Child dialog' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Child dialog' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument()
    expect(openChild).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Parent dialog' })).not.toBeInTheDocument()
    expect(parentOpener).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('does not close when the backdrop is clicked if dismissible is false', () => {
    const onClose = () => undefined
    render(
      <Modal isOpen onClose={onClose} title="Non-dismissible" dismissible={false}>
        <p>Keep open</p>
      </Modal>,
    )

    const backdrop = screen.getByRole('dialog', { name: 'Non-dismissible' }).parentElement?.firstElementChild
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(screen.getByRole('dialog', { name: 'Non-dismissible' })).toBeInTheDocument()
  })
})

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
