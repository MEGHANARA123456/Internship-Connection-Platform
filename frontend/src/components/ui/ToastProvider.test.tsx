import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { useToast, ToastProvider } from './ToastProvider'

function ToastTrigger({ onAction }: { onAction: () => void }) {
  const { toast } = useToast()
  return (
    <button
      type="button"
      onClick={() => toast('Attempt could not start.', {
        kind: 'error',
        actions: [{ label: 'Try again', onClick: onAction }],
      })}
    >
      Show toast
    </button>
  )
}

describe('ToastProvider', () => {
  it('renders an accessible actionable toast and supports dismissal', () => {
    const onAction = vi.fn()
    render(
      <ToastProvider>
        <ToastTrigger onAction={onAction} />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Attempt could not start.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onAction).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
