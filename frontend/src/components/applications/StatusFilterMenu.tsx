import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { applicationStatusMenuItems } from '../../lib/navConfig'

export interface StatusFilterMenuProps {
  activeStatus: string
  counts: Record<string, number>
  onChange: (status: string) => void
}

export function StatusFilterMenu({ activeStatus, counts, onChange }: StatusFilterMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const activeItem = applicationStatusMenuItems.find((item) => item.key === activeStatus) || applicationStatusMenuItems[0]

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const menuItems = rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
        if (!menuItems?.length) return
        const current = Array.from(menuItems).indexOf(document.activeElement as HTMLButtonElement)
        const offset = event.key === 'ArrowDown' ? 1 : -1
        menuItems[(current + offset + menuItems.length) % menuItems.length].focus()
      }
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeEscape)
    }
  }, [open])

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
          window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
        }}
        className="inline-flex min-w-52 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <span>Status: {activeItem.label} ({counts[activeItem.key] ?? 0})</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="menu" aria-label="Filter applications by status" className="absolute left-0 z-30 mt-2 max-h-80 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {applicationStatusMenuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-current={activeStatus === item.key ? 'true' : undefined}
              onClick={() => {
                onChange(item.key)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-indigo-50 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span>{item.label}</span>
              <span className="flex items-center gap-2">
                <span className="min-w-6 rounded-full bg-slate-100 px-2 py-0.5 text-center text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {counts[item.key] ?? 0}
                </span>
                {activeStatus === item.key && <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
