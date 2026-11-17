import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl'
  focusCloseButtonLast?: boolean
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = 'md',
  focusCloseButtonLast = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = dialogRef.current
    const initialFocus = dialog?.querySelector<HTMLElement>(
      'input[autofocus]:not([disabled]), textarea[autofocus]:not([disabled]), select[autofocus]:not([disabled])',
    ) ?? dialog?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
    ) ?? dialog
    initialFocus?.focus({ preventScroll: true })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }
      const orderedFocus = focusable.some((element) => element.dataset.modalFocusOrder)
        ? focusable
          .map((element, index) => ({ element, index, order: Number(element.dataset.modalFocusOrder) }))
          .sort((a, b) => {
            const aOrder = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER
            const bOrder = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER
            return aOrder - bOrder || a.index - b.index
          })
          .map(({ element }) => element)
        : focusable
      if (focusable.some((element) => element.dataset.modalFocusOrder)) {
        event.preventDefault()
        const currentIndex = orderedFocus.indexOf(document.activeElement as HTMLElement)
        const nextIndex = currentIndex < 0
          ? (event.shiftKey ? orderedFocus.length - 1 : 0)
          : (currentIndex + (event.shiftKey ? -1 : 1) + orderedFocus.length) % orderedFocus.length
        orderedFocus[nextIndex].focus({ preventScroll: true })
        return
      }
      const first = orderedFocus[0]
      const last = orderedFocus[orderedFocus.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      if (previousActiveElement?.isConnected) previousActiveElement.focus({ preventScroll: true })
    }
  }, [isOpen])

  if (!isOpen) return null

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
    '2xl': 'max-w-3xl',
    '3xl': 'max-w-4xl',
    '4xl': 'max-w-5xl',
    '5xl': 'max-w-6xl',
  }

  return (
    <div     className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        ref={dialogRef}
        className={cn(
          'glass-strong relative w-full rounded-2xl bg-white dark:bg-slate-900 p-6 text-left shadow-2xl transition-all border border-slate-200 dark:border-slate-800 z-10 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto',
          widths[maxWidth]
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="flex items-start justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
            {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            aria-label="Close dialog"
            title="Close dialog"
            data-modal-focus-order={focusCloseButtonLast ? '5' : undefined}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}
