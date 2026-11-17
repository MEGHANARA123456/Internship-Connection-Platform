import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DropdownSelect, type DropdownOption } from './DropdownSelect'
import { Modal } from './Modal'

const shortOptions: DropdownOption[] = [
  { label: 'All roles', value: '' },
  { label: 'Sales Manager', value: 'sales' },
]

let originalInnerHeight: PropertyDescriptor | undefined

function positionedTrigger(top = 100, bottom = 140, left = 40, width = 160) {
  const trigger = screen.getByRole('combobox', { name: 'Select role' })
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: top,
    top,
    bottom,
    left,
    right: left + width,
    width,
    height: bottom - top,
    toJSON: () => ({}),
  })
  return trigger
}

afterEach(() => {
  vi.restoreAllMocks()
  if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight)
  originalInnerHeight = undefined
})

describe('DropdownSelect menu portal', () => {
  it('portals the menu above following content and sizes it from the trigger', async () => {
    render(
      <>
        <DropdownSelect aria-label="Select role" value="" options={shortOptions} onChange={vi.fn()} />
        <div className="relative z-50">Following card</div>
      </>,
    )
    const trigger = positionedTrigger()
    fireEvent.click(trigger)

    const menu = await screen.findByRole('listbox')
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveClass('fixed', 'z-[10000]')
    expect(menu).toHaveStyle({ width: '224px', maxWidth: 'min(28rem, calc(100vw - 2rem))' })
    expect(menu).toHaveAttribute('data-placement', 'below')
  })

  it('opens upward near the viewport bottom', async () => {
    render(<DropdownSelect aria-label="Select role" value="" options={shortOptions} onChange={vi.fn()} />)
    const trigger = positionedTrigger(710, 750)
    fireEvent.click(trigger)

    const menu = await screen.findByRole('listbox')
    expect(menu).toHaveAttribute('data-placement', 'above')
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(710)
    expect(Number.parseFloat(menu.style.maxHeight)).toBeGreaterThan(0)
  })

  it('keeps the menu hidden until positioned and uses scroll-safe keyboard focus', async () => {
    render(<DropdownSelect aria-label="Select role" value="" options={shortOptions} onChange={vi.fn()} />)
    const trigger = positionedTrigger()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const rect = {
      x: 40, y: 100, top: 100, bottom: 140, left: 40, right: 200, width: 160, height: 40,
      toJSON: () => ({}),
    }
    const observedHiddenPosition = vi.fn()
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => {
      const menu = document.getElementById(`${trigger.id}-options`)
      if (menu) observedHiddenPosition(menu.style.position, menu.style.visibility)
      return rect
    })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const menu = await screen.findByRole('listbox')
    expect(observedHiddenPosition).toHaveBeenCalledWith('fixed', 'hidden')
    expect(menu).toHaveStyle({ visibility: 'visible' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(await screen.findByRole('option', { name: 'Sales Manager' })).toHaveFocus()
  })

  it('wraps long labels and recalculates its available height when options change', async () => {
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    const longOption = 'Sales Manager · Remote · ₹1,500/mo'
    const { rerender } = render(
      <DropdownSelect aria-label="Select role" value="" options={[{ label: longOption, value: 'sales' }]} onChange={vi.fn()} />,
    )
    const trigger = positionedTrigger(300, 340)
    fireEvent.click(trigger)
    const menu = await screen.findByRole('listbox')
    let contentHeight = 48
    Object.defineProperty(menu, 'scrollHeight', {
      configurable: true,
      get: () => contentHeight,
    })

    const longLabel = await screen.findByRole('option', { name: longOption }).then((option) => option.querySelector('span'))
    expect(longLabel).toHaveClass('whitespace-normal', 'break-words')
    expect(longLabel).not.toHaveClass('truncate')
    const initialTop = menu.style.top
    contentHeight = 288
    rerender(
      <DropdownSelect
        aria-label="Select role"
        value=""
        options={Array.from({ length: 10 }, (_, index) => ({ label: `Role ${index}`, value: String(index) }))}
        onChange={vi.fn()}
      />,
    )
    await waitFor(() => expect(menu.style.top).not.toBe(initialTop))
  })

  it('updates its fixed position on scroll', async () => {
    render(<DropdownSelect aria-label="Select role" value="" options={shortOptions} onChange={vi.fn()} />)
    const trigger = positionedTrigger(100, 140)
    const rect = {
      x: 40, y: 100, top: 100, bottom: 140, left: 40, right: 200, width: 160, height: 40,
      toJSON: () => ({}),
    }
    vi.mocked(trigger.getBoundingClientRect).mockImplementation(() => rect)
    fireEvent.click(trigger)
    const menu = await screen.findByRole('listbox')
    const originalTop = menu.style.top
    rect.top = 200
    rect.bottom = 240
    fireEvent.scroll(window)

    await waitFor(() => expect(menu.style.top).not.toBe(originalTop))
  })

  it('closes on Escape and outside click, returning focus on Escape', async () => {
    render(<DropdownSelect aria-label="Select role" value="" options={shortOptions} onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox', { name: 'Select role' })
    const focus = vi.spyOn(trigger, 'focus')
    fireEvent.click(trigger)
    await screen.findByRole('listbox')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })

    fireEvent.click(trigger)
    await screen.findByRole('listbox')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports arrow and Enter selection from the keyboard', async () => {
    const onChange = vi.fn()
    render(<DropdownSelect aria-label="Select role" value="" options={shortOptions} onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Select role' })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })

    const sales = await screen.findByRole('option', { name: 'Sales Manager' })
    await waitFor(() => expect(sales).toHaveFocus())
    fireEvent.keyDown(sales, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('sales')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('keeps its menu above a modal and lets Escape close only the menu', async () => {
    const onClose = vi.fn()
    render(
      <Modal isOpen title="Schedule interview" onClose={onClose}>
        <DropdownSelect aria-label="Select role" value="" options={shortOptions} onChange={vi.fn()} />
      </Modal>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Select role' })
    fireEvent.click(trigger)

    const menu = await screen.findByRole('listbox')
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveClass('z-[10000]')
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Schedule interview' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
