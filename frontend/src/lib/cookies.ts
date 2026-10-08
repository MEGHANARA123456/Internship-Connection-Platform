export const COOKIE_CONSENT_KEY = 'internsphere_cookie_consent'
export const THEME_COOKIE_KEY = 'internsphere_theme'

export interface CookieOptions {
  path?: string
  sameSite?: 'Strict' | 'Lax' | 'None'
  secure?: boolean
}

export interface CookieConsent {
  necessary: true
  functional: boolean
  analytics: boolean
  consentedAt: string
}

export function setCookie(
  name: string,
  value: string,
  days: number,
  opts: CookieOptions = {},
): void {
  if (typeof document === 'undefined') return

  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  const secure = opts.secure ?? (typeof window !== 'undefined' && window.location.protocol === 'https:')
  const attributes = [
    `expires=${expires}`,
    `path=${opts.path ?? '/'}`,
    `SameSite=${opts.sameSite ?? 'Lax'}`,
  ]

  if (secure) attributes.push('Secure')
  document.cookie = `${name}=${encodeURIComponent(value)}; ${attributes.join('; ')}`
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null

  const prefix = `${name}=`
  const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(prefix))
  if (!cookie) return null

  try {
    return decodeURIComponent(cookie.slice(prefix.length))
  } catch {
    return null
  }
}

export function deleteCookie(name: string, opts: Pick<CookieOptions, 'path' | 'sameSite' | 'secure'> = {}): void {
  if (typeof document === 'undefined') return

  const secure = opts.secure ?? (typeof window !== 'undefined' && window.location.protocol === 'https:')
  const attributes = [
    'expires=Thu, 01 Jan 1970 00:00:00 GMT',
    `path=${opts.path ?? '/'}`,
    `SameSite=${opts.sameSite ?? 'Lax'}`,
  ]

  if (secure) attributes.push('Secure')
  document.cookie = `${name}=; ${attributes.join('; ')}`
}

function parseConsent(value: unknown): CookieConsent | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('necessary' in value) ||
    value.necessary !== true ||
    !('functional' in value) ||
    typeof value.functional !== 'boolean' ||
    !('analytics' in value) ||
    typeof value.analytics !== 'boolean' ||
    !('consentedAt' in value) ||
    typeof value.consentedAt !== 'string'
  ) {
    return null
  }

  return {
    necessary: true,
    functional: value.functional,
    analytics: value.analytics,
    consentedAt: value.consentedAt,
  }
}

export function getCookieConsent(): CookieConsent | null {
  const cookieConsent = getCookie(COOKIE_CONSENT_KEY)
  if (cookieConsent) {
    try {
      const parsed = parseConsent(JSON.parse(cookieConsent))
      if (parsed) return parsed
    } catch {
      // Try the existing localStorage preference when the cookie is invalid.
    }
  }

  if (typeof localStorage === 'undefined') return null

  try {
    const storedConsent = localStorage.getItem(COOKIE_CONSENT_KEY)
    if (!storedConsent) return null

    const parsed: unknown = JSON.parse(storedConsent)
    if (typeof parsed !== 'object' || parsed === null) return null

    return parseConsent({
      necessary: 'necessary' in parsed ? parsed.necessary : true,
      functional: 'functional' in parsed ? parsed.functional : false,
      analytics: 'analytics' in parsed ? parsed.analytics : false,
      consentedAt: 'consentedAt' in parsed ? parsed.consentedAt : '',
    })
  } catch {
    return null
  }
}
