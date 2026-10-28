import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
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
  const controlId = useId()
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const close = (event: globalThis.KeyboardEvent | MouseEvent) => {
      if (event instanceof globalThis.KeyboardEvent && event.key === 'Escape') setOpen(false)
      if (event instanceof MouseEvent && event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('mousedown', close)
    }
  }, [open])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      window.requestAnimationFrame(() => {
        const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
        const current = items.findIndex((item) => item.getAttribute('aria-selected') === 'true')
        const offset = event.key === 'ArrowDown' ? 1 : -1
        items[(current + offset + items.length) % items.length]?.focus()
      })
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
        type="button"
        role="combobox"
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-800 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      >
        <span className="truncate">{selected?.label ?? label ?? 'Choose an option'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" aria-label={label ?? ariaLabel} className="absolute left-0 z-50 mt-1 max-h-72 w-full min-w-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span className="min-w-0 truncate">{option.label}</span>
              {value === option.value && <Check className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
