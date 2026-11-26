export type ToastKind = 'success' | 'error' | 'warning' | 'info'
export interface ToastAction {
  label: string
  onClick: () => void
}
export interface ToastOptions {
  kind?: ToastKind
  actions?: ToastAction[]
  durationMs?: number
}

export function showToast(
  message: string,
  kind: ToastKind = 'info',
  actions?: ToastAction[],
) {
  window.dispatchEvent(new CustomEvent('app:toast', {
    detail: { message, kind, actions },
  }))
}

export function confirmAction(options: {
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent('app:confirm', {
      detail: { ...options, resolve },
    }))
  })
}
