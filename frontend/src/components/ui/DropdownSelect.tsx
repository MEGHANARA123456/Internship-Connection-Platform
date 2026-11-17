import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface DropdownOption {
  label: string
  value: string
}

interface DropdownSelectProps {
  label?: string
  'aria-label'?: string
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function DropdownSelect({
  label,
  'aria-label': ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingFocusIndexRef = useRef<number | null>(null)
  const controlId = useId()
  const menuId = `${controlId}-options`
  const [menuPosition, setMenuPosition] = useState<{
    top: number
    left: number
    width: number
    maxHeight: number
    placement: 'above' | 'below'
  } | null>(null)
  const selected = options.find((option) => option.value === value)

  const closeMenu = useCallback((returnFocus = false) => {
    pendingFocusIndexRef.current = null
    setOpen(false)
    setMenuPosition(null)
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof globalThis.Node)) return
      if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      closeMenu()
    }
    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('mousedown', closeOnOutsideClick)
    }
  }, [closeMenu, open])

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger || !menu) return

      const rect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const margin = 16
      const gap = 4
      const maxWidth = Math.max(0, Math.min(448, viewportWidth - margin * 2))
      const minWidth = Math.min(224, maxWidth)
      const width = Math.min(maxWidth, Math.max(minWidth, rect.width))
      const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin))
      const desiredHeight = Math.min(menu.scrollHeight || options.length * 40 + 8, 288)
      const availableBelow = Math.max(0, viewportHeight - rect.bottom - gap - margin)
      const availableAbove = Math.max(0, rect.top - gap - margin)
      const placement: 'above' | 'below' = availableBelow < desiredHeight && availableAbove > 0
        ? 'above'
        : 'below'
      const availableHeight = placement === 'above' ? availableAbove : availableBelow
      const maxHeight = Math.max(0, Math.min(288, availableHeight))
      const top = placement === 'above'
        ? Math.max(margin, rect.top - Math.min(desiredHeight, maxHeight) - gap)
        : rect.bottom + gap
      const next = { top, left, width, maxHeight, placement }

      setMenuPosition((current) => (
        current
        && current.top === next.top
        && current.left === next.left
        && current.width === next.width
        && current.maxHeight === next.maxHeight
        && current.placement === next.placement
          ? current
          : next
      ))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, options])

  const focusOption = (index: number) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    if (!items.length) return
    items[(index + items.length) % items.length]?.focus({ preventScroll: true })
  }

  const selectOption = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    closeMenu(true)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const currentIndex = options.findIndex((option) => option.value === value)
      const offset = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + offset + options.length) % options.length
      if (open) {
        focusOption(nextIndex)
      } else {
        pendingFocusIndexRef.current = nextIndex
        setMenuPosition(null)
        setOpen(true)
      }
    }
  }

  useLayoutEffect(() => {
    if (!open || !menuPosition || pendingFocusIndexRef.current === null) return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
    const index = pendingFocusIndexRef.current
    pendingFocusIndexRef.current = null
    if (items.length) items[(index + items.length) % items.length]?.focus({ preventScroll: true })
  }, [menuPosition, open])

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(index + (event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusOption(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusOption(options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectOption(index)
    }
  }

  return (
    <div ref={rootRef} className={`relative min-w-0 space-y-1.5 text-left ${className}`}>
      {label && (
        <label htmlFor={controlId} className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          {label}
        </label>
      )}
      <button
        id={controlId}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeMenu()
          } else {
            pendingFocusIndexRef.current = null
            setMenuPosition(null)
            setOpen(true)
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        className="glass-input flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      >
        <span title={selected?.label} className="truncate">{selected?.label ?? label ?? 'Choose an option'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            aria-label={label ?? ariaLabel}
            data-placement={menuPosition?.placement ?? 'below'}
            className="glass-strong fixed z-[10000] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            style={{
              position: 'fixed',
              visibility: menuPosition ? 'visible' : 'hidden',
              top: menuPosition?.top,
              left: menuPosition?.left,
              width: menuPosition?.width,
              maxWidth: 'min(28rem, calc(100vw - 2rem))',
              maxHeight: menuPosition?.maxHeight,
            }}
          >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              onClick={() => selectOption(index)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span title={option.label} className="min-w-0 flex-1 whitespace-normal break-words">{option.label}</span>
              {value === option.value && <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />}
            </button>
          ))}
          </div>,
          document.body,
        )
      )}
    </div>
  )
}
