import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserRouter } from 'react-router-dom'
import { CookieConsentBanner } from './CookieConsentBanner'
import { deleteCookie, getCookie, setCookie, COOKIE_CONSENT_KEY, THEME_COOKIE_KEY } from '../../lib/cookies'

function renderBanner() {
  return render(
    <BrowserRouter>
      <CookieConsentBanner />
    </BrowserRouter>,
  )
}

function openBanner() {
  act(() => {
    vi.advanceTimersByTime(800)
  })
}

function openPreferences() {
  act(() => {
    window.dispatchEvent(new Event('open:cookie-preferences'))
  })
}

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    deleteCookie(COOKIE_CONSENT_KEY)
    deleteCookie(THEME_COOKIE_KEY)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes consent choices to the cookie on Accept All', () => {
    localStorage.setItem('theme', 'dark')
    renderBanner()
    openBanner()

    fireEvent.click(screen.getByRole('button', { name: 'Accept All' }))

    const consent = getCookie(COOKIE_CONSENT_KEY)
    expect(consent).not.toBeNull()
    expect(JSON.parse(consent ?? '{}')).toEqual({
      necessary: true,
      functional: true,
      analytics: true,
      consentedAt: expect.any(String),
    })
    expect(getCookie(THEME_COOKIE_KEY)).toBe('dark')

    openPreferences()
    expect(screen.getByRole('checkbox', { name: 'Functional Preferences' })).toHaveProperty('checked', true)
  })

  it('rejects optional cookies and deletes the theme cookie', () => {
    localStorage.setItem('theme', 'dark')
    setCookie(THEME_COOKIE_KEY, 'dark', 365)
    renderBanner()
    openBanner()

    fireEvent.click(screen.getByRole('button', { name: 'Essential Only' }))

    const consent = getCookie(COOKIE_CONSENT_KEY)
    expect(consent).not.toBeNull()
    expect(JSON.parse(consent ?? '{}')).toMatchObject({
      necessary: true,
      functional: false,
      analytics: false,
    })
    expect(getCookie(THEME_COOKIE_KEY)).toBeNull()
  })

  it('writes the theme cookie only when functional consent is enabled', () => {
    localStorage.setItem('theme', 'light')
    renderBanner()

    openPreferences()
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }))
    expect(getCookie(THEME_COOKIE_KEY)).toBeNull()

    openPreferences()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Functional Preferences' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }))
    expect(getCookie(THEME_COOKIE_KEY)).toBe('light')

    openPreferences()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Functional Preferences' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Preferences' }))
    expect(getCookie(THEME_COOKIE_KEY)).toBeNull()
  })
})
