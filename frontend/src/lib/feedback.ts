export type ToastKind = 'success' | 'error' | 'info'

export function showToast(message: string, kind: ToastKind = 'info') {
  window.dispatchEvent(new CustomEvent('app:toast', { detail: { message, kind } }))
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
