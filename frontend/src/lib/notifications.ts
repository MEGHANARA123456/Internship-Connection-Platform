export const BLOCKED_NOTIFICATION_TYPES = new Set([
  'MFA_CHALLENGE',
  'MFA_SETUP',
  'MFA_STATUS_CHANGE',
  'PASSWORD_RESET',
  'OTP',
  'SECURITY_CODE',
])

export function maskCodes(text: string): string {
  return text.replace(/\b\d{4,8}\b/g, '••••••')
}

export function isSensitiveNotification(notification: {
  notification_type?: string
  title?: string
  body?: string
  message?: string
}): boolean {
  return (
    BLOCKED_NOTIFICATION_TYPES.has(notification.notification_type || '') ||
    /\b\d{4,8}\b/.test(notification.title || '') ||
    /\b\d{4,8}\b/.test(notification.body || '') ||
    /\b\d{4,8}\b/.test(notification.message || '')
  )
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false
  }

  if (Notification.permission === 'granted') {
    return true
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission()
    return permission === 'granted'
  }

  return false
}

export function sendSystemNotification(title: string, options?: NotificationOptions): void {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return
  }

  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        ...options,
      })
    } catch {
      // Ignored if browser blocks background execution
    }
  }
}
