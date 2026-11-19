import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Z_INDEX } from '../../lib/zIndex'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  headerActions?: React.ReactNode
  titleAdornment?: React.ReactNode
  headerClassName?: string
  footerClassName?: string
  dismissible?: boolean
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl'
  overlayClassName?: string
  panelClassName?: string
  bodyClassName?: string
}

interface ActiveModal {
  id: symbol
  element: HTMLDivElement
}

const activeModals: ActiveModal[] = []
let previousBodyOverflow: string | null = null

function registerModal(id: symbol, element: HTMLDivElement) {
  if (activeModals.length === 0) {
    previousBodyOverflow = document.body.style.overflow
  }
  activeModals.push({ id, element })
  document.body.style.overflow = 'hidden'
}

function unregisterModal(id: symbol): HTMLDivElement | null {
  const index = activeModals.findIndex((modal) => modal.id === id)
  if (index === -1) return activeModals.at(-1)?.element ?? null

  activeModals.splice(index, 1)
  if (activeModals.length === 0) {
    document.body.style.overflow = previousBodyOverflow ?? ''
    previousBodyOverflow = null
    return null
  }
  return activeModals.at(-1)?.element ?? null
}

function isTopModal(id: symbol): boolean {
  return activeModals.at(-1)?.id === id
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  headerActions,
  titleAdornment,
  headerClassName,
  footerClassName,
  dismissible = true,
  maxWidth = 'md',
  overlayClassName,
  panelClassName,
  bodyClassName,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const modalIdRef = useRef(Symbol('modal'))
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined' || !document.body) return

    const dialog = dialogRef.current
    if (!dialog) return

    const modalId = modalIdRef.current
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    registerModal(modalId, dialog)

    const firstFocusable = dialog.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    ;(firstFocusable ?? dialog).focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(modalId)) return

      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => {
        const style = window.getComputedStyle(element)
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && !element.closest('[hidden], [aria-hidden="true"], .hidden')
      })

      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      const nextDialog = unregisterModal(modalId)
      if (
        previousActiveElement?.isConnected
        && (!nextDialog || nextDialog.contains(previousActiveElement))
      ) {
        previousActiveElement.focus()
      }
    }
  }, [isOpen])

  if (!isOpen || typeof document === 'undefined' || !document.body) return null

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

  return createPortal(
    <div className={cn('fixed inset-0 flex items-center justify-center p-4', Z_INDEX.modal, overlayClassName)}>
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={() => {
          if (dismissible && isTopModal(modalIdRef.current)) onCloseRef.current()
        }}
      />
      <div
        ref={dialogRef}
        className={cn(
          'glass-strong relative z-10 flex w-full min-h-0 max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-left shadow-2xl transition-all animate-in zoom-in-95 dark:border-slate-800 dark:bg-slate-900',
          widths[maxWidth],
          panelClassName,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className={cn('flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 pb-4 pt-6 dark:border-slate-800', headerClassName)}>
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {titleAdornment}
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
              {description && <p id={descriptionId} className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
            </div>
          </div>
          {headerActions && <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">{headerActions}</div>}
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close dialog"
            title="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={cn('min-h-0 overflow-y-auto overscroll-contain p-6', bodyClassName)}>
          {children}
        </div>

        {footer && (
          <div className={cn('sticky bottom-0 z-10 shrink-0 border-t border-slate-100 bg-white/95 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95', footerClassName)}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
