import { create } from 'zustand'

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

const initialTheme = ((typeof localStorage !== 'undefined' && localStorage.getItem('theme')) as Theme) || 'system'
const initialIsDark = applyTheme(initialTheme)

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  isDark: initialIsDark,
  setTheme: (theme: Theme) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('theme', theme)
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
