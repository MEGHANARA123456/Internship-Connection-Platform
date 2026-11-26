import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import type { ToastAction, ToastKind, ToastOptions } from '../../lib/feedback'
import { Z_INDEX } from '../../lib/zIndex'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  actions: ToastAction[]
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const id = ++nextId.current
    const kind = options.kind ?? 'info'
    const item: ToastItem = {
      id,
      message,
      kind,
      actions: options.actions ?? [],
    }
    setItems((current) => [...current.filter((existing) => existing.message !== message), item].slice(-5))
    const duration = options.durationMs ?? (kind === 'error' ? 8000 : 5000)
    timers.current.set(id, window.setTimeout(() => dismiss(id), duration))
    return id
  }, [dismiss])

  useEffect(() => {
    const receiveToast = (event: Event) => {
      const detail = (event as CustomEvent<{
        message: string
        kind?: ToastKind
        actions?: ToastAction[]
        durationMs?: number
      }>).detail
      if (detail?.message) {
        toast(detail.message, {
          kind: detail.kind,
          actions: detail.actions,
          durationMs: detail.durationMs,
        })
      }
    }
    window.addEventListener('app:toast', receiveToast)
    return () => {
      window.removeEventListener('app:toast', receiveToast)
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current.clear()
    }
  }, [toast])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={`pointer-events-none fixed right-4 top-4 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 ${Z_INDEX.toast}`}>
        {items.map((item) => (
          <section
            key={item.id}
            role="alert"
            aria-live={item.kind === 'error' ? 'assertive' : 'polite'}
            className={`pointer-events-auto rounded-xl border p-4 text-sm shadow-xl ${
              item.kind === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100'
                : item.kind === 'error'
                  ? 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100'
                  : item.kind === 'warning'
                    ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
                    : 'border-slate-300 bg-white text-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{item.message}</p>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(item.id)}
                className="rounded p-1 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {item.actions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {item.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => {
                      dismiss(item.id)
                      action.onClick()
                    }}
                    className="rounded-md border border-current/30 px-2.5 py-1.5 text-xs font-semibold hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/10"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (context) return context
  return {
    toast: (message, options) => {
      const id = Date.now()
      window.dispatchEvent(new CustomEvent('app:toast', {
        detail: { message, ...options },
      }))
      return id
    },
    dismiss: () => undefined,
  }
}
