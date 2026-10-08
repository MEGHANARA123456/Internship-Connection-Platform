import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { useThemeStore } from './theme'

afterEach(() => {
  useThemeStore.getState().setTheme('light')
})

describe('theme wiring', () => {
  it('applies dark mode to the html element used by Tailwind dark variants', () => {
    useThemeStore.getState().setTheme('dark')

    expect(document.documentElement).toHaveClass('dark')
    expect(useThemeStore.getState().isDark).toBe(true)
  })

  it('removes the dark class when switching back to light mode', () => {
    useThemeStore.getState().setTheme('dark')
    useThemeStore.getState().setTheme('light')

    expect(document.documentElement).not.toHaveClass('dark')
  })
})
