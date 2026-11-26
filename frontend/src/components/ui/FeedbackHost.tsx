import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface Confirmation {
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
  resolve: (confirmed: boolean) => void
}

export function FeedbackHost() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const activeConfirmation = useRef<Confirmation | null>(null)

  useEffect(() => {
    const showConfirmation = (event: Event) => {
      const next = (event as CustomEvent<Confirmation>).detail
      activeConfirmation.current?.resolve(false)
      activeConfirmation.current = next
      setConfirmation(next)
    }
    window.addEventListener('app:confirm', showConfirmation)
    return () => {
      window.removeEventListener('app:confirm', showConfirmation)
    }
  }, [])

  const finishConfirmation = (confirmed: boolean) => {
    activeConfirmation.current?.resolve(confirmed)
    activeConfirmation.current = null
    setConfirmation(null)
  }

  return (
    <>
      <Modal
        isOpen={confirmation !== null}
        onClose={() => finishConfirmation(false)}
        title={confirmation?.title ?? ''}
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{confirmation?.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => finishConfirmation(false)}>Cancel</Button>
          <Button
            variant={confirmation?.destructive ? 'danger' : 'primary'}
            onClick={() => finishConfirmation(true)}
          >
            {confirmation?.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </Modal>
    </>
  )
}
