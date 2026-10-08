import { create } from 'zustand'
import {
  deleteCookie,
  getCookie,
  getCookieConsent,
  setCookie,
  THEME_COOKIE_KEY,
} from '../lib/cookies'

export type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  isDark: boolean
}

function getSystemTheme(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(theme: Theme): boolean {
  const isDark = theme === 'dark' || (theme === 'system' && getSystemTheme())
  if (typeof document !== 'undefined') {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }
  return isDark
}

function parseTheme(theme: string | null): Theme | null {
  return theme === 'light' || theme === 'dark' || theme === 'system' ? theme : null
}

const hasFunctionalConsent = () => getCookieConsent()?.functional === true
const cookieTheme = hasFunctionalConsent() ? parseTheme(getCookie(THEME_COOKIE_KEY)) : null
const storedTheme = typeof localStorage !== 'undefined' ? parseTheme(localStorage.getItem('theme')) : null
const initialTheme = cookieTheme ?? storedTheme ?? 'system'
const initialIsDark = applyTheme(initialTheme)

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  isDark: initialIsDark,
  setTheme: (theme: Theme) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('theme', theme)
    }
    if (hasFunctionalConsent() && (theme === 'light' || theme === 'dark')) {
      setCookie(THEME_COOKIE_KEY, theme, 365)
    } else {
      deleteCookie(THEME_COOKIE_KEY)
    }
    const isDark = applyTheme(theme)
    set({ theme, isDark })
  },
}))

// Listener for system preference changes
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', () => {
        const currentTheme = useThemeStore.getState().theme
        if (currentTheme === 'system') {
          const isDark = applyTheme('system')
          useThemeStore.setState({ isDark })
        }
      })
    }
  } catch {
    // Ignore unsupported environment
  }
}
