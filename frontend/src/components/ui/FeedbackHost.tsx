import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'
import type { ToastKind } from '../../lib/feedback'

interface Confirmation {
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
  resolve: (confirmed: boolean) => void
}

interface ToastMessage {
  id: number
  message: string
  kind: ToastKind
}

export function FeedbackHost() {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const toastId = useRef(0)
  const activeConfirmation = useRef<Confirmation | null>(null)

  useEffect(() => {
    const showConfirmation = (event: Event) => {
      const next = (event as CustomEvent<Confirmation>).detail
      activeConfirmation.current?.resolve(false)
      activeConfirmation.current = next
      setConfirmation(next)
    }
    const showToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; kind: ToastKind }>).detail
      const id = ++toastId.current
      setToast({ id, ...detail })
      window.setTimeout(() => {
        setToast((current) => current?.id === id ? null : current)
      }, 3500)
    }
    window.addEventListener('app:confirm', showConfirmation)
    window.addEventListener('app:toast', showToast)
    return () => {
      window.removeEventListener('app:confirm', showConfirmation)
      window.removeEventListener('app:toast', showToast)
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
      {toast && (
        <div
          key={toast.id}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          className={`fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.kind === 'success'
              ? 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100'
              : toast.kind === 'error'
                ? 'bg-rose-100 text-rose-950 dark:bg-rose-950 dark:text-rose-100'
                : 'bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-slate-100'
          }`}
        >
          {toast.message}
        </div>
      )}
    </>
  )
}
